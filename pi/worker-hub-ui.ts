import { Editor, Input, matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi, getKeybindings, type TUI } from "@earendil-works/pi-tui";
import { copyToClipboard, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { isActive, WorkerHub } from "./lib/worker-hub.ts";
import type { WorkerDelivery, WorkerRecord } from "./lib/worker-types.ts";
import type { WorkflowControl } from "./lib/workflow-control.ts";
import { NativeTranscript, safeText, type Viewport } from "./lib/worker-transcript.ts";

const safe = (text: unknown) => safeText(String(text ?? "")).replace(/[\r\n\t]+/g, " ");
const fmt = (n: number | null | undefined) => n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const pad = (text: string, width: number) => { const t = truncateToWidth(text, Math.max(1, width)); return t + " ".repeat(Math.max(0, width - visibleWidth(t))); };
const stateText = (r: WorkerRecord): string => r.state === "completed" ? "Finished" : r.state === "working" ? "Running" : r.state;
const duration = (r: WorkerRecord): string => { const s = Math.max(0, Math.floor(((r.endedAt ?? Date.now()) - r.startedAt) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
type ContextUsage = { percent: number | null; tokens: number | null; contextWindow: number | null };
const contextUsage = (record: WorkerRecord): ContextUsage | undefined => {
  const value = record.context; if (!value) return undefined;
  return { percent: value.percent, tokens: value.tokens, contextWindow: value.contextWindow };
};
const contextText = (r: WorkerRecord): string => { const context = contextUsage(r); return context?.percent == null ? "Context —" : `Context ${context.percent.toFixed(1)}% (${fmt(context.tokens)}/${fmt(context.contextWindow)})`; };
const statsText = (r: WorkerRecord): string => `${fmt(r.stats.totalTokens)} processed · ${fmt(r.stats.tools)} tools · ${fmt(r.stats.requests)} replies`;
const glyph = (r: WorkerRecord): string => r.state === "working" ? "●" : r.state === "completed" ? "✓" : r.state === "failed" ? "×" : r.state === "aborting" ? "◐" : "○";
const color = (r: WorkerRecord): "error" | "success" | "accent" | "warning" => r.state === "failed" ? "error" : r.state === "completed" ? "success" : r.state === "working" ? "accent" : "warning";
const sendKey = () => getKeybindings().getKeys("tui.input.submit").map(k => k === "enter" ? "Enter" : k).join("/") || "F2 actions";
const hintLines = (hints: string[], width: number) => {
  const lines: string[] = []; let row = "";
  for (const hint of hints) {
    if (row && visibleWidth(`${row} · ${hint}`) > width) { lines.push(row); row = ""; }
    if (visibleWidth(hint) > width) { if (row) lines.push(row); lines.push(...wrapTextWithAnsi(hint, Math.max(1, width))); row = ""; }
    else row += `${row ? " · " : ""}${hint}`;
  }
  if (row) lines.push(row); return lines;
};

export function compactWorkerLines(records: WorkerRecord[], title = "Agents"): string[] {
  const running = records.filter(isActive), unread = records.filter(r => r.unread && r.closed);
  const shown = running.length ? running.slice(0, 3) : unread.slice(-1);
  return [`${title} · ${running.length} running${unread.length ? ` · ${unread.length} new results` : ""} · Alt+A inspect`,
    ...shown.map(r => ` ${glyph(r)} ${safe(r.label)} · ${safe(r.activity)}`),
    ...(running.length > shown.length ? [` +${running.length - shown.length} more in Agent Hub`] : [])];
}

type Composer = { editor: Editor; version: number; sending: boolean };
export type HubViewState = {
  selectedId: string | undefined; mode: "roster" | "thread"; composers: Map<string, Composer>;
  viewports: Map<string, Viewport>; notices: Map<string, string>; repaint: () => void;
};
export const createHubViewState = (): HubViewState => ({ selectedId: undefined, mode: "roster", composers: new Map(), viewports: new Map(), notices: new Map(), repaint: () => {} });

type Action = { title: string; run: () => unknown | Promise<unknown> };
type HubUIOptions = {
  control?: () => WorkflowControl | undefined;
  respond?: (questionId?: string) => void | Promise<void>;
  resume?: () => void | Promise<void>;
  copy?: (text: string) => void | Promise<void>;
};
/** One surface, shared by ordinary child tools and deterministic controllers. */
export class AgentHubView {
  private unsubscribe: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private transcripts = new Map<string, NativeTranscript>();
  private unpin?: () => void;
  private panel: "help" | "actions" | "confirm" | "search" | undefined;
  private search = new Input({ prompt: "Find: " });
  private filter = "";
  private menu: Action[] = [];
  private menuIndex = 0;
  private menuReady = false;
  private confirm?: Action;
  private disposed = false;
  private narrowDetails = false;
  private helpScroll = 0;
  private detailScroll = 0;
  private _focused = true;
  private canCompose = true;
  private tui: TUI;
  private theme: Theme;
  private hub: WorkerHub;
  private title: string | (() => string);
  private done: () => void;
  private state: HubViewState;
  private options: HubUIOptions;
  constructor(tui: TUI, theme: Theme, hub: WorkerHub, title: string | (() => string), done: () => void,
    state: HubViewState = createHubViewState(), options: HubUIOptions = {}) {
    this.tui=tui;this.theme=theme;this.hub=hub;this.title=title;this.done=done;this.state=state;this.options=options;
    this.state.repaint = () => this.repaint();
    this.unsubscribe = hub.subscribe(() => {
      const first = hub.list()[0]; if (!this.state.selectedId && first) this.select(first.id);
      this.schedule();
    });
    if (!state.selectedId) state.selectedId = hub.list()[0]?.id;
    if (state.selectedId) this.unpin = hub.pin(state.selectedId);
    this.search.onSubmit = () => {
      if (state.mode === "thread") {
        const found = this.transcript()?.search(this.viewport(), this.search.getValue());
        this.notice(found ? "Match found. Enter finds the next match; Esc returns to your draft." : "No match in available transcript.");
      } else { this.applyFilter(); this.panel = undefined; }
      this.repaint();
    };
  }
  get focused() { return this._focused; }
  set focused(value: boolean) { this._focused = value; this.setEditorFocus(); }
  private setEditorFocus() {
    for (const [id, c] of this.state.composers) c.editor.focused = this._focused && this.state.mode === "thread" && !this.panel && this.canCompose && id === this.state.selectedId;
    this.search.focused = this._focused && this.panel === "search";
  }
  private schedule() {
    if (!this.timer && !this.disposed) this.timer = setTimeout(() => { this.timer = undefined; this.repaint(); }, 50);
  }
  private repaint() { if (!this.disposed) this.tui.requestRender(); }
  private current() { return this.hub.get(this.state.selectedId); }
  private rows() {
    const q = this.filter.toLocaleLowerCase();
    return this.hub.list().filter(r => !q || `${r.label} ${String(r.metadata["task"] ?? "")} ${r.role}`.toLocaleLowerCase().includes(q));
  }
  private applyFilter() {
    this.filter = this.search.getValue();
    const rows = this.rows();
    const first = rows[0]; if (first && !rows.some(r => r.id === this.state.selectedId)) this.select(first.id);
  }
  private notice(text: string, id = this.state.selectedId || "hub") { this.state.notices.set(id, text); this.state.repaint(); }
  private viewport() {
    const id = this.state.selectedId!;
    if (!this.state.viewports.has(id)) this.state.viewports.set(id, { follow: true });
    return this.state.viewports.get(id)!;
  }
  private transcript() {
    const id = this.state.selectedId; if (!id) return;
    try {
      const record = this.hub.load(id);
      if (!this.transcripts.has(id)) {
        if (this.transcripts.size >= 3) {
          const oldest = this.transcripts.keys().next().value!;
          this.transcripts.get(oldest)!.dispose(); this.transcripts.delete(oldest);
        }
        const transcript = new NativeTranscript({ ...this.tui, requestRender: () => this.schedule() }, record);
        transcript.setExpanded(!!this.state.viewports.get(id)?.expanded);
        this.transcripts.set(id, transcript);
      }
      const transcript = this.transcripts.get(id)!; transcript.sync(record); return transcript;
    } catch (error: unknown) { this.notice(error instanceof Error ? error.message : String(error), id); return; }
  }
  private select(id: string) {
    if (!this.hub.get(id)) return;
    if (this.state.selectedId) this.hub.flushDraft(this.state.selectedId);
    this.unpin?.(); this.unpin = this.hub.pin(id); this.state.selectedId = id; this.detailScroll = 0;
    this.setEditorFocus(); this.repaint();
  }
  private move(delta: number) {
    const rows = this.state.mode === "thread" ? this.hub.list() : this.rows();
    const i = rows.findIndex(r => r.id === this.state.selectedId);
    const target = rows[Math.max(0, Math.min(rows.length - 1, i + delta))];
    if (target) this.select(target.id);
  }
  private composer(id: string): Composer {
    let c = this.state.composers.get(id); if (c) return c;
    const proxy = { terminal: this.tui.terminal || { rows: 24 }, requestRender: () => this.state.repaint() };
    const editor = new Editor(proxy as TUI, {
      borderColor: (s: string) => this.theme.fg("borderAccent", s),
      selectList: { selectedPrefix: s => s, selectedText: s => s, description: s => s, scrollInfo: s => s, noMatch: s => s },
    }, { paddingX: 1 });
    c = { editor, version: 0, sending: false }; this.state.composers.set(id, c);
    editor.setText(this.hub.get(id)?.draft || "");
    editor.onChange = () => { c!.version++; this.hub.setDraft(id, editor.getExpandedText()); };
    // Pi's Editor clears on submission. Restore synchronously; clear only after
    // acceptance and only if this same thread's draft has not changed meanwhile.
    editor.onSubmit = text => { editor.setText(text); void this.send(id, "steer"); };
    return c;
  }
  private async send(id: string, mode: "steer" | "followUp") {
    const c = this.composer(id), text = c.editor.getExpandedText();
    if (c.sending || !text.trim()) return;
    const version = c.version; c.sending = true;
    try {
      const delivery = await this.hub.send(id, text, mode);
      if (c.version === version) c.editor.setText("");
      this.notice(`${delivery.status === "delivered" ? "Delivered" : "Queued"} to ${this.hub.get(id)?.label}. ${mode === "steer" ? "Current tools are not cancelled." : "Runs after current work."}`, id);
    } catch (error: unknown) { this.notice(`Not sent: ${error instanceof Error ? error.message : String(error)}`, id); }
    finally { c.sending = false; this.hub.flushDraft(id); this.state.repaint(); }
  }
  private open() {
    if (!this.current() || !this.rows().some(r => r.id === this.state.selectedId)) return;
    this.state.mode = "thread"; this.panel = undefined; this.transcript(); this.composer(this.state.selectedId!);
    this.setEditorFocus(); this.repaint();
  }
  private back() {
    if (this.panel) this.panel = undefined;
    else if (this.state.mode === "roster" && this.narrowDetails) this.narrowDetails = false;
    else if (this.state.mode === "thread") this.state.mode = "roster";
    else { this.done(); return; }
    this.setEditorFocus(); this.repaint();
  }
  private stopAction() {
    const r = this.current(); if (!isActive(r)) return;
    const scope = r.metadata["parentId"] ? "Only this investigation stops. Its parent may continue." : r.metadata["owner"] === "workflow" ? "The owning workflow will stop with partial work preserved." : "Only this agent and its children stop.";
    this.confirm = { title: `Stop ${r.label}? ${scope} Already completed edits/commands are not undone.`, run: () => this.hub.abort(r.id) };
    this.menuReady = false; this.menuIndex = 0; this.panel = "confirm"; this.setEditorFocus(); this.repaint();
  }
  private actions() {
    const r = this.current(), id = r?.id;
    this.menu = [];
    const control = this.options.control?.();
    for (const question of this.hub.questions()) this.menu.push({ title: `Respond: ${this.hub.get(question.ownerId)?.label || "Agent"} · ${question.title} (in Main)`, run: () => { this.done(); setImmediate(() => this.options.respond?.(question.id)); } });
    if (control?.pending) this.menu.push({ title: `Respond: ${control.pending.title} (in Main)`, run: () => { this.done(); setImmediate(() => this.options.respond?.()); } });
    if (control?.state === "running") {
      this.menu.push({ title: "Pause workflow after current safe step", run: () => control.pause() });
      this.menu.push({ title: "Stop workflow now (preserve partial work)", run: () => {
        this.confirm = { title: "Stop the workflow and all its workers? Completed effects are not undone.", run: () => control.stop() };
        this.panel = "confirm"; this.menuReady = false; this.menuIndex = 0;
      } });
    } else if (control?.state === "paused") this.menu.push({ title: "Continue paused workflow (revalidate unchanged work)", run: () => { this.done(); setImmediate(() => this.options.resume?.()); } });
    else if (control && ["stopped", "failed"].includes(control.state)) this.menu.push({ title: `Recovery: ${control.resumeCommand}`, run: () => this.notice(`Reconcile partial work, then run ${control.resumeCommand} in Main.`) });
    if (id && this.hub.canSend(id)) this.menu.push({ title: "Queue this draft after the agent's current work", run: () => this.send(id, "followUp") });
    if (r?.actions?.cancelQueued && r.deliveries.some(d => d.status === "queued")) { const workerId = r.id; this.menu.push({ title: "Cancel ALL still-queued messages to this agent", run: () => this.hub.cancelQueued(workerId).then(n => this.notice(`Cancelled ${n} queued messages. Original text is retained.`, workerId)) }); }
    if (r?.closed && r.file && this.hub.onRelated) { const workerId = r.id; this.menu.push({ title: "Investigate this draft in a NEW read-only thread", run: async () => {
      const c = this.composer(workerId), text = c.editor.getExpandedText();
      if (!text.trim()) { this.notice("Write a follow-up question first. Original result remains unchanged.", workerId); return; }
      const version = c.version; const newId = await this.hub.related(workerId, text);
      if (c.version === version) c.editor.setText("");
      this.select(newId); this.open();
    } }); }
    const failed = r ? [...r.deliveries].reverse().find((d: WorkerDelivery) => d.status === "failed" || d.status === "cancelled") : undefined;
    if (failed && r) { const workerId = r.id; this.menu.push({ title: "Restore undelivered message into this thread's draft", run: () => {
      const c = this.composer(workerId);
      if (c.editor.getExpandedText().trim()) { this.notice("Draft is not empty; copy it before restoring another message.", workerId); return; }
      c.editor.setText(failed.text); this.open();
    } }); }
    if (id) {
      this.menu.push({ title: "Copy full available transcript", run: async () => { this.hub.load(id); const text = this.transcript()?.exportText(); if (text) await (this.options.copy ? this.options.copy(text) : copyToClipboard(text)); this.notice("Transcript copied.", id); } });
      this.menu.push({ title: "Expand / collapse tool output", run: () => { const v = this.viewport(); v.expanded = !v.expanded; this.transcript()?.setExpanded(!!v.expanded); } });
      this.menu.push({ title: "Show / hide provider-supplied thinking", run: () => this.transcript()?.toggleThinking() });
      if (isActive(r)) this.menu.push({ title: `Stop ${r.label}…`, run: () => this.stopAction() });
    }
    this.menu.push({ title: "Return to Main (agents keep running)", run: () => this.done() });
    this.menuReady = false; this.menuIndex = 0; this.panel = "actions"; this.setEditorFocus(); this.repaint();
  }

  handleInput(data: string) {
    if (matchesKey(data, "alt+a")) { this.done(); return; }
    if (matchesKey(data, "escape")) { this.back(); return; }
    if (matchesKey(data, "f1") || (this.state.mode === "roster" && !this.panel && data === "?")) { this.panel = this.panel === "help" ? undefined : "help"; this.setEditorFocus(); this.repaint(); return; }
    if (this.panel === "help") {
      if (matchesKey(data, "pageDown") || matchesKey(data, "down")) this.helpScroll += 5;
      if (matchesKey(data, "pageUp") || matchesKey(data, "up")) this.helpScroll = Math.max(0, this.helpScroll - 5);
      this.repaint(); return;
    }
    if (this.panel === "search") { this.search.handleInput(data); if (this.state.mode === "roster") this.applyFilter(); this.repaint(); return; }
    if (this.panel === "actions" || this.panel === "confirm") {
      const items = this.panel === "confirm" ? [{ title: "Cancel", run: () => {} }, this.confirm!] : this.menu;
      if (matchesKey(data, "up") || data === "k") { this.menuIndex = Math.max(0, this.menuIndex - 1); this.menuReady = false; }
      else if (matchesKey(data, "down") || data === "j") { this.menuIndex = Math.min(items.length - 1, this.menuIndex + 1); this.menuReady = false; }
      else if (matchesKey(data, "enter")) {
        if (!this.menuReady) return;
        this.menuReady = false;
        const action = items[this.menuIndex], actionId = this.state.selectedId; this.panel = undefined;
        if (action) void Promise.resolve().then(() => action.run()).catch((e: unknown) => this.notice(e instanceof Error ? e.message : String(e), actionId)).finally(() => { this.setEditorFocus(); this.repaint(); });
      }
      this.repaint(); return;
    }
    if (matchesKey(data, "f2")) { this.actions(); return; }
    if (matchesKey(data, "f3") || (this.state.mode === "roster" && data === "/")) {
      this.panel = "search"; this.search.setValue(this.state.mode === "roster" ? this.filter : ""); this.setEditorFocus(); this.repaint(); return;
    }
    if (this.state.mode === "thread") {
      if (matchesKey(data, "alt+up")) { this.move(-1); return; }
      if (matchesKey(data, "alt+down")) { this.move(1); return; }
      if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) { this.transcript()?.scroll(this.viewport(), (matchesKey(data, "pageUp") ? -1 : 1) * Math.max(1, (this.viewport().height || 10) - 1)); this.repaint(); return; }
      if (matchesKey(data, "f4")) { this.transcript()?.live(this.viewport()); this.repaint(); return; }
      if (matchesKey(data, "ctrl+o")) { const v = this.viewport(); v.expanded = !v.expanded; this.transcript()?.setExpanded(!!v.expanded); this.repaint(); return; }
      if (matchesKey(data, "ctrl+x")) { this.stopAction(); return; }
      if (!this.canCompose || (this.tui.terminal?.rows || 24) < 10) { this.notice("Resize the terminal to edit; your draft is preserved."); return; }
      const id = this.state.selectedId;
      if (id && this.current()) this.composer(id).editor.handleInput(data);
      this.repaint(); return;
    }
    if (this.narrowDetails && (matchesKey(data, "pageUp") || matchesKey(data, "pageDown"))) { this.detailScroll = Math.max(0, this.detailScroll + (matchesKey(data, "pageUp") ? -5 : 5)); this.repaint(); return; }
    if (matchesKey(data, "up") || data === "k") this.move(-1);
    else if (matchesKey(data, "down") || data === "j") this.move(1);
    else if (matchesKey(data, "enter")) this.open();
    else if (matchesKey(data, "tab")) this.narrowDetails = !this.narrowDetails;
    else if (data === "x") this.stopAction();
    this.repaint();
  }

  private roster(width: number, height: number) {
    const rows = this.rows();
    if (!rows.length) return new Text(this.filter ? "No matching agents. F3 changes the filter." : "No child agents yet. Work in Main normally; children appear here when created. Esc returns to Main.", 1, 1).render(width);
    const selected = rows.findIndex(r => r.id === this.state.selectedId);
    const count = Math.max(1, Math.floor(height / 3));
    const start = Math.max(0, Math.min(selected - Math.floor(count / 2), rows.length - count));
    return rows.slice(start, start + count).flatMap(r => {
      const chosen = r.id === this.state.selectedId;
      const parentId = typeof r.metadata["parentId"] === "string" ? r.metadata["parentId"] : undefined;
      const parent = this.hub.get(parentId);
      const lines = [
        `${chosen ? this.theme.fg("accent", "›") : " "} ${this.theme.fg(color(r), glyph(r))} ${safe(r.label)}${r.unread && r.closed ? " · new" : ""}`,
        `    ${safe(r.role)} · ${safe(r.model)} ${safe(r.thinking)} · ${stateText(r)}`,
        `    ${parent ? `↳ ${safe(parent.label)} · ` : ""}${safe(r.activity)}`,
      ].map(t => pad(t, width));
      return chosen ? lines.map(t => this.theme.bg("selectedBg", t)) : lines;
    });
  }
  private details(width: number, height: number) {
    const r = this.current(); if (!r) return ["Select a thread to inspect it."];
    const parentId = typeof r.metadata["parentId"] === "string" ? r.metadata["parentId"] : undefined;
    const parent = this.hub.get(parentId);
    const cost = r.stats?.cost == null ? "Reported cost —" : `Reported cost $${r.stats.cost.toFixed(4)} (not subscription billing)`;
    const sections = [this.theme.bold(safe(r.label)), `${stateText(r)} · ${duration(r)}`, "",
      ...(r.storageError ? [`History warning: ${safe(r.storageError)}`] : []),
      "TASK", safe(r.metadata["task"] || "No task supplied"), "", "CURRENT", safe(r.outcome || r.activity), "",
      contextText(r), statsText(r), cost, `VCC ${r.metadata["vcc"] ? "loaded" : "not reported"}`, parent ? `Parent: ${safe(parent.label)}` : "Parent: Main",
      r.file ? `Saved: ${safe(r.file)}` : "History: memory-only session", r.closed ? "Read-only result. F2 starts a related investigation." : "Enter opens this agent. Your drafts stay with their recipient."];
    const lines = sections.flatMap(t => wrapTextWithAnsi(t, Math.max(1, width)));
    this.detailScroll = Math.min(this.detailScroll, Math.max(0, lines.length - height));
    return lines.slice(this.detailScroll, this.detailScroll + height);
  }
  private thread(width: number, height: number) {
    const r = this.current(); if (!r) return ["This thread is unavailable. Your draft was not retargeted. Esc returns to agents."];
    this.canCompose = height >= 7 && width >= 20;
    if (!this.canCompose) { this.setEditorFocus(); return new Text("Resize to inspect and edit this thread. Input is paused; drafts are preserved. Esc returns to agents.", 0, 0).render(width); }
    const c = this.composer(r.id); this.setEditorFocus();
    const editorLines = c.editor.render(Math.max(1, width));
    const editorHeight = Math.min(Math.max(3, Math.floor(height / 3)), editorLines.length);
    const delivery = r.deliveries?.at(-1);
    const recipient = `To: ${safe(r.label)}${this.hub.canSend(r.id) ? "" : " · read-only result"}`;
    const status = delivery ? `${delivery.status === "failed" ? "NOT DELIVERED" : delivery.status}: ${safe(delivery.error || (delivery.mode === "followUp" ? "after current work" : "next turn boundary"))}` : r.closed ? "F2 → New investigation uses this draft; it does not restart this agent." : `${sendKey()} sends; it does not cancel a running tool.`;
    const transcriptHeight = Math.max(0, height - editorHeight - 3);
    const window = this.transcript()?.window(this.viewport(), width, transcriptHeight);
    const lines = window?.lines || [];
    while (lines.length < transcriptHeight) lines.push("");
    // Editor owns its scrolling/cursor. When space is limited retain the rows
    // around its cursor, not an arbitrary prefix of a multiline paste.
    const marker = editorLines.findIndex(l => l.includes("\x1b_pi:c\x07"));
    const from = Math.max(0, Math.min(marker - editorHeight + 2, editorLines.length - editorHeight));
    return [
      this.theme.fg("muted", `${contextText(r)} · ${this.viewport().follow ? "Live" : "Reading history · F4 live"} · ${window ? `${window.start + 1}–${window.end}/${window.total}` : ""}`),
      ...lines, this.theme.fg("accent", recipient), ...editorLines.slice(from, from + editorHeight), this.theme.fg(delivery?.status === "failed" ? "error" : "muted", status),
    ].slice(0, height);
  }
  private panelLines(width: number, height: number) {
    if (this.panel === "help") {
      const lines = new Text([
      "AGENT HUB · Navigation without changing execution", "",
      "Alt+A opens/closes the hub; agents keep running. Esc goes back and keeps drafts.",
      "Roster: ↑↓ / j k choose; Enter opens; Tab shows details on narrow terminals; F3 filters.",
      `Thread: type + ${sendKey()} sends to the named recipient. Left/Home/End still edit text; multiline pastes are preserved.`,
      "Alt+↑/↓ switches threads. Each thread keeps its own draft and reading position.",
      "PgUp/PgDn browse history. F4 returns to live. F3 searches; Enter finds next. Ctrl+O expands tool output.",
      "F2 actions: queue after current work, copy transcript, related investigation, or stop with confirmation.",
      "Queued is not delivered, and sending does not interrupt executing tools. Failed delivery remains recoverable.",
      "Completed results are read-only. A new investigation never restarts an accepted Builder or changes an old verdict.",
      "Workflow pause waits for a safe boundary. Stop requests cancellation; neither action undoes completed effects.",
      "Human approvals wait in Main until you explicitly choose Respond. Ordinary hub Enter never approves work.",
    ].join("\n"), 1, 0).render(width);
      this.helpScroll = Math.min(this.helpScroll, Math.max(0, lines.length - height));
      return lines.slice(this.helpScroll, this.helpScroll + height);
    }
    if (this.panel === "search") return [...this.search.render(width), ...new Text("Enter finds next / applies filter. Esc returns to the saved draft.", 0, 0).render(width)];
    const items = this.panel === "confirm" ? [{ title: "Cancel", run: () => {} }, { title: "Stop", run: () => {} }] : this.menu;
    const intro = this.panel === "confirm" ? new Text(safe(this.confirm?.title), 1, 0).render(width) : ["Actions · Nothing runs until selected"];
    const head = intro.slice(0, Math.max(0, height - (this.panel === "confirm" ? 3 : 2)));
    const gap = head.length ? [""] : [];
    const available = Math.max(0, height - head.length - gap.length), start = Math.max(0, this.menuIndex - available + 1);
    this.menuReady = available > 0 && this.menuIndex >= start && this.menuIndex < Math.min(items.length, start + available);
    return [...head, ...gap, ...items.slice(start, start + available).map((a, i) => {
      const t = pad(`${i + start === this.menuIndex ? "›" : " "} ${a.title}`, width);
      return i + start === this.menuIndex ? this.theme.bg("selectedBg", t) : t;
    })];
  }
  render(width: number): string[] {
    width = Math.max(1, width);
    const height = Math.max(1, this.tui.terminal?.rows || process.stdout.rows || 24);
    const title = typeof this.title === "function" ? this.title() : this.title;
    const r = this.current();
    const header = [this.theme.fg("accent", this.theme.bold(`Agent Hub · ${this.state.mode === "thread" ? safe(r?.label || "Unavailable thread") : safe(title)}`))];
    const control = this.options.control?.();
    if (this.hub.questions().length && height >= 12) header.push(this.theme.fg("warning", `${this.hub.questions().length} agents need you · F2 respond`));
    if (control && height >= 12) header.push(this.theme.fg(control.pending ? "warning" : "muted", safe(`${control.phase} · ${control.state} · ${control.pending ? `Needs you: ${control.pending.title} · F2 respond` : control.pauseRequested ? "Pause requested; finishing current step" : control.activity}`)));
    const hints = this.panel ? ["Esc back", "F1 help", ...(this.panel === "help" ? ["PgUp/Dn more"] : []), ...(this.panel === "actions" || this.panel === "confirm" ? ["↑↓ choose", "Enter select"] : [])]
      : this.state.mode === "thread" ? ["Esc back", "F1 help", `${sendKey()} send`, "Alt+↑↓ switch", "F2 actions", "PgUp/Dn history", "F4 live"]
      : ["Esc Main", "F1 help", "↑↓ choose", "Enter open", "F2 actions", "F3 find", "Tab details", ...(this.narrowDetails ? ["PgUp/Dn more"] : [])];
    const footer = height < 8 || width < 20
      ? hintLines(["Esc", "F1 help"], width).slice(0, Math.max(1, height - 1))
      : hintLines(hints, width).slice(0, Math.max(2, Math.min(3, Math.floor(height / 4))));
    const notice = this.state.notices.get(this.state.selectedId || "hub");
    const noticeRows = notice && height >= 12 ? 1 : 0;
    const bodyHeight = Math.max(0, height - header.length - footer.length - noticeRows);
    let body: string[];
    if (this.panel) body = this.panelLines(width, bodyHeight);
    else if (this.state.mode === "thread") body = this.thread(width, bodyHeight);
    else if (width >= 100) {
      const leftWidth = Math.floor((width - 3) * .45), rightWidth = width - 3 - leftWidth;
      const left = this.roster(leftWidth, bodyHeight), right = this.details(rightWidth, bodyHeight);
      body = Array.from({ length: bodyHeight }, (_, i) => `${pad(left[i] || "", leftWidth)} ${this.theme.fg("borderMuted", "│")} ${pad(right[i] || "", rightWidth)}`);
    } else body = this.narrowDetails ? this.details(width, bodyHeight) : this.roster(width, bodyHeight);
    body = body.slice(0, bodyHeight); while (body.length < bodyHeight) body.push("");
    const lines = [...header, ...body, ...(noticeRows ? [this.theme.fg("warning", safe(notice))] : []), ...footer.map(t => this.theme.fg("muted", t))];
    return lines.slice(0, height).map(t => truncateToWidth(t, width));
  }
  invalidate() { for (const t of this.transcripts.values()) t.invalidate(); for (const c of this.state.composers.values()) c.editor.invalidate(); }
  dispose() {
    this.hub.flush(); this.disposed = true; if (this.timer) clearTimeout(this.timer); this.unsubscribe(); this.unpin?.();
    for (const t of this.transcripts.values()) t.dispose();
    this.state.repaint = () => {}; for (const c of this.state.composers.values()) c.editor.focused = false;
  }
}

export function registerWorkerHubUI(pi: ExtensionAPI, hub: WorkerHub, options: HubUIOptions = {}) {
  let ctx: ExtensionContext | undefined, title = "Main session", open: Promise<unknown> | undefined, close: (() => void) | undefined, disposed = false;
  let state = createHubViewState();
  const seen = new Map<string, string>();
  const widget = () => {
    if (!ctx?.hasUI || disposed) return;
    ctx.ui.setWidget("dev-workers", (_tui: TUI, theme: Theme) => ({
      render: (width: number) => {
        const control = options.control?.();
        const status = control ? [safe(`${control.phase} · ${control.state} · ${control.pending ? `Needs you: ${control.pending.title} · /dev-respond` : control.pauseRequested ? "Pause requested" : control.activity}`)] : [];
        const questions = hub.questions();
        return [...status, ...(questions.length ? [`${questions.length} agents need you · /dev-respond`] : []), ...compactWorkerLines(hub.list())].map(t => theme.fg("muted", truncateToWidth(t, width)));
      }, invalidate() {},
    }));
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => { if (!timer && !disposed) timer = setTimeout(() => { timer = undefined; widget(); }, 50); };
  const unsubscribe = hub.subscribe((records: WorkerRecord[]) => {
    refresh();
    for (const r of records) {
      if (seen.get(r.id) === r.state) continue;
      seen.set(r.id, r.state);
      if (!r.closed || r.unread) pi.appendEntry?.("dev-worker-event", { id: r.id, label: r.label, state: r.state, file: r.file, outcome: r.outcome });
    }
  });
  pi.registerEntryRenderer?.("dev-worker-event", (entry, _renderOptions, theme) => {
    const data = entry.data && typeof entry.data === "object" ? entry.data as Record<string, unknown> : {};
    return new Text(theme.fg("muted", `${safe(data["label"])} · ${safe(data["state"])}${data["outcome"] ? ` · ${safe(data["outcome"])}` : ""}`), 0, 0);
  });
  const show = async (commandCtx: ExtensionContext | undefined = ctx): Promise<unknown> => {
    if (!commandCtx?.hasUI || disposed) return undefined;
    if (open) { close?.(); return open; }
    ctx = commandCtx;
    open = ctx.ui.custom((tui, theme, _keys, done) => {
      close = () => done(undefined);
      return new AgentHubView(tui, theme, hub, () => title, close, state, options);
    }, { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 } });
    try { return await open; } finally { open = undefined; close = undefined; widget(); }
  };
  pi.registerCommand("dev-workers", { description: "Agent Hub: inspect, message, or stop child agents", handler: async (_args, nextCtx) => { ctx = nextCtx; await show(); } });
  pi.registerShortcut("alt+a", { description: "Agent Hub: switch child threads or return to Main", handler: async nextCtx => { ctx = nextCtx; await show(); } });
  return {
    setContext(next: ExtensionContext) { ctx = next; widget(); },
    setWorkflow(next?: string) { title = next || "Main session"; refresh(); },
    refresh,
    async beforePrompt() { close?.(); if (open) await open; await new Promise(resolve => setImmediate(resolve)); },
    dispose() { disposed = true; close?.(); if (timer) clearTimeout(timer); unsubscribe(); hub.flush(); ctx?.ui.setWidget("dev-workers", undefined); state = createHubViewState(); ctx = undefined; },
  };
}
