import { Editor, Input, matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi, getKeybindings, type TuiMouseEvent, type TuiMouseEventResult, type TUI } from "@earendil-works/pi-tui";
import { copyToClipboard, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { isActive, WorkerHub } from "./lib/worker-hub.ts";
import type { WorkerDelivery, WorkerRecord } from "./lib/worker-types.ts";
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
  order: string[]; filter: string; status: string; role: string; sort: "priority" | "newest" | "oldest" | "role";
};
export const createHubViewState = (): HubViewState => ({ selectedId: undefined, mode: "roster", composers: new Map(), viewports: new Map(), notices: new Map(), repaint: () => {}, order: [], filter: "", status: "all", role: "all", sort: "priority" });

type Action = { title: string; run: () => unknown | Promise<unknown> };
type HubUIOptions = { copy?: (text: string) => void | Promise<void> };
/** One surface for native child-session inspection and steering. */
export class AgentHubView {
  private unsubscribe: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private transcripts = new Map<string, NativeTranscript>();
  private unpin?: () => void;
  private panel: "help" | "actions" | "confirm" | "search" | "delivery" | undefined;
  private receiptSelection = new Map<string, string>();
  private search = new Input({ prompt: "Find: " });

  private menu: Action[] = [];
  private menuIndex = 0;
  private menuReady = false;
  private confirm?: Action;
  private confirmLabel = "Stop";
  private disposed = false;
  private narrowDetails = false;
  private helpScroll = 0;
  private detailScroll = 0;
  private _focused = true;
  private canCompose = true;
  private displayedQuestions = new Map<string, string | null>();
  private hits: Array<{ y: number; x0: number; x1: number; run: () => void }> = [];
  private editorBounds?: { y: number; height: number; width: number; from: number };
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
      this.reconcile();
      this.schedule();
    });
    this.reconcile(true);
    if (state.selectedId && !this.unpin) this.unpin = hub.pin(state.selectedId);
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
  private question(id = this.state.selectedId) { return this.hub.questions().find(question => question.ownerId === id); }
  private eligible(r: WorkerRecord) {
    const q = this.state.filter.toLocaleLowerCase();
    return (!q || `${r.label} ${r.activity} ${String(r.metadata["task"] ?? "")} ${r.role}`.toLocaleLowerCase().includes(q))
      && (this.state.status === "all" || (this.state.status === "active" ? isActive(r) : this.state.status === "unread" ? r.closed && r.unread : r.state === this.state.status))
      && (this.state.role === "all" || r.role === this.state.role);
  }
  private priority(r: WorkerRecord) { return this.question(r.id) || r.state === "failed" ? 0 : isActive(r) ? 1 : r.closed && r.unread ? 2 : 3; }
  private reconcile(rebuild = false) {
    const all = this.hub.list(), index = new Map(all.map((r, i) => [r.id, i]));
    const eligible = all.filter(r => this.eligible(r));
    if (rebuild) {
      eligible.sort((a, b) => {
        const diff = this.state.sort === "priority" ? this.priority(a) - this.priority(b)
          : this.state.sort === "newest" ? b.startedAt - a.startedAt
          : this.state.sort === "oldest" ? a.startedAt - b.startedAt : a.role.localeCompare(b.role);
        return diff || index.get(a.id)! - index.get(b.id)!;
      });
      this.state.order = eligible.map(r => r.id);
    } else {
      const valid = new Set(eligible.map(r => r.id));
      this.state.order = this.state.order.filter(id => valid.has(id));
      for (const r of eligible) if (!this.state.order.includes(r.id)) this.state.order.push(r.id);
    }
    if (!this.state.order.includes(this.state.selectedId || "") && this.state.mode === "roster") {
      const next = this.state.order[0];
      if (next) this.select(next);
      else { this.unpin?.(); delete this.unpin; this.state.selectedId = undefined; this.setEditorFocus(); }
    }
  }
  private rows() { return this.state.order.map(id => this.hub.get(id)).filter((r): r is WorkerRecord => !!r); }
  private applyFilter() { this.state.filter = this.search.getValue(); this.reconcile(true); }
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
        transcript.setHideThinking(this.state.viewports.get(id)?.hideThinking ?? true);
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
    const expectedQuestion = mode === "steer" ? this.displayedQuestions.get(id) : null;
    try {
      const question = expectedQuestion ? this.hub.questions().find(q => q.id === expectedQuestion && q.ownerId === id && !q.answering) : undefined;
      if (expectedQuestion && !question) throw new Error("The displayed question is no longer pending. Review your draft before choosing another action.");
      if (!expectedQuestion && mode === "steer" && this.question(id)) throw new Error("A new question is pending. Review the answer intent before submitting.");
      if (question) {
        await question.answer({ answer: text });
        c.editor.addToHistory(text);
        if (c.version === version) c.editor.setText("");
        this.notice(`Answer accepted by ${this.hub.get(id)?.label}.`, id);
      } else {
        const delivery = await this.hub.send(id, text, mode);
        c.editor.addToHistory(text);
        if (c.version === version) c.editor.setText("");
        this.notice(`${delivery.status === "delivered" ? "Delivered" : delivery.status === "queued" ? "Queued (not delivered)" : "Cancelled before delivery"} to ${this.hub.get(id)?.label}. ${mode === "steer" ? "Current tools are not cancelled." : "Runs after current work."}`, id);
      }
    } catch (error: unknown) { this.notice(`Not sent: ${error instanceof Error ? error.message : String(error)}`, id); }
    finally { c.sending = false; this.hub.flushDraft(id); this.state.repaint(); }
  }
  private open() {
    if (!this.current() || !this.rows().some(r => r.id === this.state.selectedId)) return;
    this.state.mode = "thread"; this.panel = undefined; this.transcript(); this.composer(this.state.selectedId!);
    this.displayedQuestions.set(this.state.selectedId!, this.question()?.id ?? null);
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
    const scope = r.metadata["parentId"] ? "Only this investigation stops. Its parent may continue." : "Only this agent and its children stop.";
    this.confirmLabel = "Stop";
    this.confirm = { title: `Stop ${r.label}? ${scope} Already completed edits/commands are not undone.`, run: () => this.hub.abort(r.id) };
    this.menuReady = false; this.menuIndex = 0; this.panel = "confirm"; this.setEditorFocus(); this.repaint();
  }
  private actions() {
    const r = this.current(), id = r?.id;
    this.menu = [];
    if (id && this.hub.canSend(id)) this.menu.push({ title: "Queue this draft after the agent's current work", run: () => this.send(id, "followUp") });
    if (id) this.menu.push({ title: "Inspect delivery receipts and recover a selected message", run: () => this.deliveryPanel(id) });
    if (r?.actions?.cancelQueued && r.deliveries.some(d => d.status === "queued")) { const workerId = r.id; this.menu.push({ title: "Cancel ALL still-queued messages to this agent…", run: () => this.cancelQueueAction(workerId) }); }
    if (r?.closed && r.file && this.hub.onRelated) { const workerId = r.id; this.menu.push({ title: "Investigate this draft in a NEW read-only thread", run: async () => {
      const c = this.composer(workerId), text = c.editor.getExpandedText();
      if (!text.trim()) { this.notice("Write a follow-up question first. Original result remains unchanged.", workerId); return; }
      const version = c.version; const newId = await this.hub.related(workerId, text);
      if (c.version === version) c.editor.setText("");
      this.select(newId); this.open();
    } }); }

    if (id) {
      this.menu.push({ title: "Copy full available transcript", run: async () => { this.hub.load(id); const text = this.transcript()?.exportText(); if (text) await (this.options.copy ? this.options.copy(text) : copyToClipboard(text)); this.notice("Transcript copied.", id); } });
      this.menu.push({ title: "Expand / collapse tool output", run: () => { const v = this.viewport(); v.expanded = !v.expanded; this.transcript()?.setExpanded(!!v.expanded); } });
      this.menu.push({ title: "Show / hide provider-supplied thinking", run: () => { const v = this.viewport(); v.hideThinking = !(v.hideThinking ?? true); this.transcript()?.setHideThinking(v.hideThinking); } });
      if (isActive(r)) this.menu.push({ title: `Stop ${r.label}…`, run: () => this.stopAction() });
    }
    this.menu.push({ title: "Return to Main (agents keep running)", run: () => this.done() });
    this.menuReady = false; this.menuIndex = 0; this.panel = "actions"; this.setEditorFocus(); this.repaint();
  }

  private deliveryPanel(id: string) {
    if (!this.hub.get(id) || id !== this.state.selectedId) return;
    this.panel = "delivery";
    if (!this.receiptSelection.has(id)) { const last = this.hub.get(id)?.deliveries.at(-1); if (last) this.receiptSelection.set(id, last.id); }
    this.setEditorFocus(); this.repaint();
  }
  private cancelQueueAction(id: string) {
    const r = this.hub.get(id);
    if (!r?.actions?.cancelQueued || !isActive(r) || !r.deliveries.some(d => d.status === "queued")) return;
    this.confirmLabel = "Cancel all queued";
    this.confirm = { title: `Cancel ALL still-queued messages to ${safe(r.label)}? This does not stop running tools or retract delivered messages. Original text remains recoverable.`, run: () => this.hub.cancelQueued(id).then(n => this.notice(`Cancelled ${n} still-queued messages.`, id)) };
    this.menuReady = false; this.menuIndex = 0; this.panel = "confirm"; this.setEditorFocus(); this.repaint();
  }
  private restoreSelected() {
    const id = this.state.selectedId, r = this.current(); if (!id || !r) return;
    const receipt = r.deliveries.find(d => d.id === this.receiptSelection.get(id));
    if (!receipt || !["failed", "cancelled"].includes(receipt.status)) { this.notice("Select a failed or cancelled receipt to recover.", id); return; }
    const c = this.composer(id);
    if (c.editor.getExpandedText()) { this.notice("Draft is not empty; copy it before restoring another message.", id); return; }
    c.editor.setText(receipt.text); this.panel = undefined;
    this.notice(r.closed ? "Recovered in this closed thread. F2 can start a NEW read-only investigation; this agent cannot receive it." : "Recovered into this thread's draft. Review before sending.", id);
    this.setEditorFocus(); this.repaint();
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
    if (this.panel === "delivery") {
      const r = this.current(), receipts = r?.deliveries || [];
      const index = receipts.findIndex(d => d.id === this.receiptSelection.get(r?.id || ""));
      if (matchesKey(data, "up") || data === "k") { const next = receipts[Math.max(0, index - 1)]; if (next && r) this.receiptSelection.set(r.id, next.id); }
      else if (matchesKey(data, "down") || data === "j") { const next = receipts[Math.min(receipts.length - 1, index + 1)]; if (next && r) this.receiptSelection.set(r.id, next.id); }
      else if (matchesKey(data, "enter")) this.restoreSelected();
      else if (data === "c" && r) this.cancelQueueAction(r.id);
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
    if (matchesKey(data, "f7") && this.state.mode === "thread" && this.state.selectedId) { this.deliveryPanel(this.state.selectedId); return; }
    if (matchesKey(data, "f3") || (this.state.mode === "roster" && data === "/")) {
      this.panel = "search"; this.search.setValue(this.state.mode === "roster" ? this.state.filter : ""); this.setEditorFocus(); this.repaint(); return;
    }
    if (this.state.mode === "thread") {
      if (matchesKey(data, "alt+up")) { this.move(-1); return; }
      if (matchesKey(data, "alt+down")) { this.move(1); return; }
      if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) { this.transcript()?.scroll(this.viewport(), (matchesKey(data, "pageUp") ? -1 : 1) * Math.max(1, (this.viewport().height || 10) - 1)); this.repaint(); return; }
      if (matchesKey(data, "f4")) { this.transcript()?.live(this.viewport()); this.repaint(); return; }
      if (matchesKey(data, "f5") || matchesKey(data, "f6")) { const v = this.viewport(); if (v.searchQuery) this.transcript()?.search(v, v.searchQuery, matchesKey(data, "f5") ? -1 : 1); this.repaint(); return; }
      if (matchesKey(data, "ctrl+o")) { const v = this.viewport(); v.expanded = !v.expanded; this.transcript()?.setExpanded(!!v.expanded); this.repaint(); return; }
      if (matchesKey(data, "ctrl+x")) { this.stopAction(); return; }
      if (!this.canCompose || (this.tui.terminal?.rows || 24) < 10) { this.notice("Resize the terminal to edit; your draft is preserved."); return; }
      const id = this.state.selectedId;
      if (id && this.current()) this.composer(id).editor.handleInput(data);
      this.repaint(); return;
    }
    if (data === "0") { this.state.filter = ""; this.state.status = "all"; this.state.role = "all"; this.search.setValue(""); this.reconcile(true); this.repaint(); return; }
    if (data === "s") { const statuses = ["all", "active", "unread", "failed", "completed"]; this.state.status = statuses[(statuses.indexOf(this.state.status) + 1) % statuses.length]!; this.reconcile(true); this.repaint(); return; }
    if (data === "r") { const roles = ["all", ...new Set(this.hub.list().map(r => r.role))]; this.state.role = roles[(roles.indexOf(this.state.role) + 1) % roles.length]!; this.reconcile(true); this.repaint(); return; }
    if (data === "o") { const sorts = ["priority", "newest", "oldest", "role"] as const; this.state.sort = sorts[(sorts.indexOf(this.state.sort) + 1) % sorts.length]!; this.reconcile(true); this.repaint(); return; }
    if (this.narrowDetails && (matchesKey(data, "pageUp") || matchesKey(data, "pageDown"))) { this.detailScroll = Math.max(0, this.detailScroll + (matchesKey(data, "pageUp") ? -5 : 5)); this.repaint(); return; }
    if (matchesKey(data, "up") || data === "k") this.move(-1);
    else if (matchesKey(data, "down") || data === "j") this.move(1);
    else if (matchesKey(data, "enter")) this.open();
    else if (matchesKey(data, "tab")) this.narrowDetails = !this.narrowDetails;
    else if (data === "x") this.stopAction();
    this.repaint();
  }

  private roster(width: number, height: number, originY = 1, originX = 0) {
    const rows = this.rows();
    if (!rows.length) return new Text(this.hub.list().length ? `No matching agents. Find: ${this.state.filter || "all"} · Status: ${this.state.status} · Role: ${this.state.role}. F3 find, s status, r role, 0 reset.` : "No child agents yet. Work in Main normally; children appear here when created. Esc returns to Main.", 1, 1).render(width);
    const all = this.hub.list();
    const summary = `${all.filter(isActive).length} active · ${all.filter(r => r.closed && r.unread).length} unread · ${this.hub.questions().length} questions · ${all.filter(r => r.state === "failed").length} failed`;
    const scope = `Find: ${this.state.filter || "all"} · Status: ${this.state.status} · Role: ${this.state.role} · Sort: ${this.state.sort}  [F3 find · s status · r role · o sort · 0 reset]`;
    const selected = rows.findIndex(r => r.id === this.state.selectedId);
    const count = Math.max(1, Math.floor(Math.max(0, height - 3) / 3));
    const start = Math.max(0, Math.min(selected - Math.floor(count / 2), rows.length - count));
    const visible = rows.slice(start, start + count);
    const section = (r: WorkerRecord) => isActive(r) ? "ACTIVE" : r.closed && r.unread ? "UNREAD RESULTS" : "HISTORY";
    for (const [label, key] of [["F3 find", "\x1bOR"], ["s status", "s"], ["r role", "r"], ["o sort", "o"], ["0 reset", "0"]] as const) {
      const x = scope.indexOf(label);
      if (x >= 0 && x + label.length <= width) this.hits.push({ y: originY + 1, x0: originX + x, x1: originX + x + label.length, run: () => this.handleInput(key) });
    }
    visible.forEach((r, i) => this.hits.push({ y: originY + 3 + i * 3, x0: originX, x1: originX + width, run: () => this.select(r.id) },
      { y: originY + 4 + i * 3, x0: originX, x1: originX + width, run: () => this.select(r.id) },
      { y: originY + 5 + i * 3, x0: originX, x1: originX + width, run: () => this.select(r.id) }));
    return [this.theme.bold(summary), this.theme.fg("muted", scope),
      this.theme.fg("accent", `Showing ${start + 1}–${start + visible.length}/${rows.length} · active / unread results / history`),
      ...visible.flatMap(r => {
      const chosen = r.id === this.state.selectedId;
      const parentId = typeof r.metadata["parentId"] === "string" ? r.metadata["parentId"] : undefined;
      const parent = this.hub.get(parentId);
      const lines = [
        `${chosen ? this.theme.fg("accent", "›") : " "} ${this.theme.fg(color(r), glyph(r))} ${safe(r.label)}${r.unread && r.closed ? " · new" : ""}${this.question(r.id) ? " · QUESTION" : r.state === "failed" ? " · ATTENTION" : ""}`,
        `    ${section(r)} · ${safe(r.role)} · ${safe(r.model)} ${safe(r.thinking)} · ${stateText(r)}`,
        `    ${parent ? `↳ ${safe(parent.label)} · ` : ""}${safe(r.activity)}`,
      ].map(t => pad(t, width));
      return chosen ? lines.map(t => this.theme.bg("selectedBg", t)) : lines;
    })];
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
    if (!this.canCompose) {
      this.setEditorFocus();
      const notice = `Input paused (resize to edit) · ${safe(r.label)} · ${stateText(r)}`;
      const space = Math.max(0, height - 2);
      const window = this.transcript()?.window(this.viewport(), width, space);
      return [notice, ...(window?.lines || []), "PgUp/Dn history · F4 live · Esc back · F1 help"].slice(0, height);
    }
    const c = this.composer(r.id); this.setEditorFocus();
    const editorLines = c.editor.render(Math.max(1, width));
    const editorHeight = Math.min(Math.max(3, Math.floor(height / 3)), editorLines.length);
    const delivery = r.deliveries?.at(-1), question = this.question(r.id);
    this.displayedQuestions.set(r.id, question?.id ?? null);
    const recipient = question ? `Question from ${safe(r.label)}: ${safe(question.title)} · answer ID ${safe(question.id)}` : `To: ${safe(r.label)}${this.hub.canSend(r.id) ? " · steer (F2 queues follow-up)" : " · read-only result"}`;
    const status = question ? `${sendKey()} answers this question directly.` : delivery ? `${delivery.status === "failed" ? "NOT DELIVERED" : delivery.status}: ${safe(delivery.error || (delivery.mode === "followUp" ? "after current work" : "next turn boundary"))}` : r.closed ? "F2 → New investigation uses this draft; it does not restart this agent." : `${sendKey()} sends; it does not cancel a running tool.`;
    const transcriptHeight = Math.max(0, height - editorHeight - 4);
    const window = this.transcript()?.window(this.viewport(), width, transcriptHeight);
    const lines = window?.lines || [];
    while (lines.length < transcriptHeight) lines.push("");
    // Editor owns its scrolling/cursor. When space is limited retain the rows
    // around its cursor, not an arbitrary prefix of a multiline paste.
    const marker = editorLines.findIndex(l => l.includes("\x1b_pi:c\x07"));
    const from = Math.max(0, Math.min(marker - editorHeight + 2, editorLines.length - editorHeight));
    this.editorBounds = { y: 1 + transcriptHeight + 3, height: editorHeight, width, from };
    return [
      this.theme.bold(`${safe(r.role)} · ${stateText(r)} · ${safe(r.outcome || r.activity)}`),
      this.theme.fg("muted", `${contextText(r)} · ${this.viewport().follow ? "Live" : "Reading history · F4 live"} · ${window ? `${window.start + 1}–${window.end}/${window.total}` : ""}${this.viewport().searchQuery ? ` · Find ${safe(this.viewport().searchQuery)} ${this.viewport().match || 0}/${this.viewport().matches || 0} (F5/F6)` : ""}`),
      ...lines, this.theme.fg("accent", recipient), ...editorLines.slice(from, from + editorHeight), this.theme.fg(delivery?.status === "failed" ? "error" : "muted", status),
    ].slice(0, height);
  }
  private panelLines(width: number, height: number) {
    if (this.panel === "help") {
      const lines = new Text([
      "AGENT HUB · Navigation without changing execution", "",
      "Alt+A opens/closes the hub; agents keep running. Esc goes back and keeps drafts.",
      "Roster: ↑↓ / j k choose; Enter opens; Tab shows details on narrow terminals; F3 finds; s status, r role, o sort, 0 resets filters.",
      `Thread: type + ${sendKey()} sends to the named recipient. Left/Home/End still edit text; multiline pastes are preserved.`,
      "Alt+↑/↓ switches threads. Each thread keeps its own draft and reading position.",
      "PgUp/PgDn browse history. F4 returns to live. F3 searches; F5/F6 previous/next match. Ctrl+O expands tool output.",
      "When an agent asks a question, the composer answers it directly; ↑/↓ recalls sent answers and messages.",
      "F2 actions: queue after current work, copy transcript, related investigation, or stop with confirmation. F7 shows per-thread delivery receipts; select and Enter to recover failed/cancelled text.",
      "Queued is not delivered, and sending does not interrupt executing tools. Failed delivery remains recoverable.",
      "Completed results are read-only. A new investigation never restarts an accepted Builder or changes an old verdict.",
    ].join("\n"), 1, 0).render(width);
      this.helpScroll = Math.min(this.helpScroll, Math.max(0, lines.length - height));
      return lines.slice(this.helpScroll, this.helpScroll + height);
    }
    if (this.panel === "delivery") {
      const r = this.current(); if (!r) return ["Thread unavailable. Esc returns."];
      const rows = r.deliveries;
      const intro = [`DELIVERIES · ${safe(r.label)} · ${rows.length} receipts`, "↑↓ select · Enter recover failed/cancelled · c confirm ALL queued · Esc back"];
      if (!rows.length) return [...intro, "No messages sent to this thread."];
      const selected = Math.max(0, rows.findIndex(d => d.id === this.receiptSelection.get(r.id)));
      const count = Math.max(1, Math.floor((height - intro.length) / 2));
      const start = Math.max(0, Math.min(selected - Math.floor(count / 2), rows.length - count));
      const visible = rows.slice(start, start + count);
      const lines = visible.flatMap((d, i) => {
        const y = 1 + intro.length + i * 2;
        this.hits.push({ y, x0: 0, x1: width, run: () => { this.receiptSelection.set(r.id, d.id); this.repaint(); } });
        return [`${d.id === this.receiptSelection.get(r.id) ? "›" : " "} ${safe(d.id)} · ${safe(r.label)} · ${d.mode} · ${d.status} · ${new Date(d.at).toISOString()}`,
          `  ${safe(d.error || d.text)}`];
      });
      return [...intro, ...lines];
    }
    if (this.panel === "search") return [...this.search.render(width), ...new Text("Enter finds next / applies filter. Esc returns to the saved draft.", 0, 0).render(width)];
    const items = this.panel === "confirm" ? [{ title: "Cancel", run: () => {} }, { title: this.confirmLabel, run: () => {} }] : this.menu;
    const intro = this.panel === "confirm" ? new Text(safe(this.confirm?.title), 1, 0).render(width) : ["Actions · Nothing runs until selected"];
    const head = intro.slice(0, Math.max(0, height - (this.panel === "confirm" ? 3 : 2)));
    const gap = head.length ? [""] : [];
    const available = Math.max(0, height - head.length - gap.length), start = Math.max(0, this.menuIndex - available + 1);
    this.menuReady = available > 0 && this.menuIndex >= start && this.menuIndex < Math.min(items.length, start + available);
    const origin = 1 + head.length + gap.length;
    items.slice(start, start + available).forEach((_a, i) => this.hits.push({ y: origin + i, x0: 0, x1: width, run: () => { this.menuIndex = start + i; this.menuReady = true; this.repaint(); } }));
    return [...head, ...gap, ...items.slice(start, start + available).map((a, i) => {
      const t = pad(`${i + start === this.menuIndex ? "›" : " "} ${a.title}`, width);
      return i + start === this.menuIndex ? this.theme.bg("selectedBg", t) : t;
    })];
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      if (this.state.mode === "thread" && !this.panel) this.transcript()?.scroll(this.viewport(), (event.wheelDelta || 0) * 3);
      else if (this.state.mode === "roster" && !this.panel) this.move(event.wheelDelta && event.wheelDelta < 0 ? -1 : 1);
      else return;
      this.repaint(); return { handled: true };
    }
    if (event.type !== "click" || event.button !== "left") return;
    if (this.editorBounds && !this.panel && this.state.mode === "thread" && this.canCompose && event.y >= this.editorBounds.y && event.y < this.editorBounds.y + this.editorBounds.height) {
      const result = this.composer(this.state.selectedId!).editor.handleMouse?.({ ...event, y: event.y - this.editorBounds.y + this.editorBounds.from, width: this.editorBounds.width, height: this.editorBounds.height });
      return result?.handled ? result : { handled: true };
    }
    const hit = this.hits.find(h => h.y === event.y && event.x >= h.x0 && event.x < h.x1);
    if (!hit) return;
    hit.run();
    if (event.clickCount && event.clickCount >= 2) {
      if (this.panel === "actions" || this.panel === "confirm") this.handleInput("\r");
      else if (this.state.mode === "roster") this.open();
    }
    return { handled: true, focus: true };
  }
  render(width: number): string[] {
    width = Math.max(1, width);
    this.hits = []; delete this.editorBounds;
    const height = Math.max(1, this.tui.terminal?.rows || process.stdout.rows || 24);
    const title = typeof this.title === "function" ? this.title() : this.title;
    const r = this.current();
    const header = [this.theme.fg("accent", this.theme.bold(`Agent Hub · ${this.state.mode === "thread" ? safe(r?.label || "Unavailable thread") : safe(title)}`))];
    const hints = this.panel ? ["Esc back", "F1 help", ...(this.panel === "help" ? ["PgUp/Dn more"] : []), ...(this.panel === "actions" || this.panel === "confirm" ? ["↑↓/click choose", "Enter/double-click select"] : [])]
      : this.state.mode === "thread" ? ["Esc back", "F1 help", `${sendKey()} send`, "Alt+↑↓ switch", "F2 actions", "F7 delivery", "PgUp/Dn history", "F4 live"]
      : ["Esc Main", "F1 help", "↑↓ choose", "Enter/double-click open", "F2 actions", "F3 find", "Tab details", ...(this.narrowDetails ? ["PgUp/Dn more"] : [])];
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
      const left = this.roster(leftWidth, bodyHeight, 1, 0), right = this.details(rightWidth, bodyHeight);
      body = Array.from({ length: bodyHeight }, (_, i) => `${pad(left[i] || "", leftWidth)} ${this.theme.fg("borderMuted", "│")} ${pad(right[i] || "", rightWidth)}`);
    } else body = this.narrowDetails ? this.details(width, bodyHeight) : this.roster(width, bodyHeight, 1, 0);
    body = body.slice(0, bodyHeight); while (body.length < bodyHeight) body.push("");
    const footerStart = header.length + body.length + noticeRows;
    for (const [i, line] of footer.entries()) for (const [label, action] of [
      ["F1 help", () => this.handleInput("\x1bOP")], ["F2 actions", () => this.actions()], ["F7 delivery", () => { if (this.state.selectedId) this.deliveryPanel(this.state.selectedId); }],
      ["F3 find", () => this.handleInput("\x1bOR")], ["F4 live", () => this.handleInput("\x1bOS")],
      ["Esc back", () => this.back()], ["Esc Main", () => this.back()],
    ] as const) {
      const x = line.indexOf(label);
      if (x >= 0 && x + label.length <= width) this.hits.push({ y: footerStart + i, x0: x, x1: x + label.length, run: action });
    }
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
    ctx.ui.setWidget("agent-hub", (_tui: TUI, theme: Theme) => ({
      render: (width: number) => {
        return compactWorkerLines(hub.list()).map(t => theme.fg("muted", truncateToWidth(t, width)));
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
  pi.registerShortcut("alt+a", { description: "Agent Hub: switch child threads or return to Main", handler: async nextCtx => { ctx = nextCtx; await show(); } });
  return {
    setContext(next: ExtensionContext) { ctx = next; widget(); },
    refresh,
    async beforePrompt() { close?.(); if (open) await open; await new Promise(resolve => setImmediate(resolve)); },
    dispose() { disposed = true; close?.(); if (timer) clearTimeout(timer); unsubscribe(); hub.flush(); ctx?.ui.setWidget("agent-hub", undefined); state = createHubViewState(); ctx = undefined; },
  };
}
