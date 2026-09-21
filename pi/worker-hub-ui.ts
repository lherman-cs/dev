import { Editor, Input, matchesKey, Text, truncateToWidth, visibleWidth, CURSOR_MARKER } from "@earendil-works/pi-tui";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { WorkerTranscript, rawTranscript, safeText, plainContent } from "./lib/worker-transcript.ts";

const running = (r: any) => ["starting", "working", "aborting"].includes(r.state);
const compact = (n: any) => typeof n !== "number" ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const fit = (s: string, width: number) => truncateToWidth(s, Math.max(0, width));
const pad = (s: string, width: number) => { const text = fit(s, width); return text + " ".repeat(Math.max(0, width - visibleWidth(text))); };
const model = (r: any) => `${safeText(r.model).replace(/^gpt-[\d.]+-/, "")} ${safeText(r.thinking)}`;
const glyph = (r: any) => r.state === "working" ? "●" : r.state === "starting" ? "◌" : r.state === "failed" ? "!" : r.state === "aborting" ? "◐" : "○";
const duration = (r: any) => `${Math.max(0, Math.floor(((r.endedAt ?? Date.now()) - r.startedAt) / 1000))}s`;
const wrap = (text: string, width: number) => new Text(text, 0, 0).render(Math.max(1, width));
export const workerLines = (record: any) => safeText(rawTranscript(record)).split("\n");

export function compactWorkerLines(records: any[], title = "Agents") {
  if (!records.length) return [`${title} · Alt+A open · /dev-workers`];
  const active = records.filter(running);
  const rows = active.length ? active.slice(0, 4) : records.slice(-1);
  return [`${title} · ${active.length} running · ${records.length - active.length} finished/history · Alt+A open`,
    ...rows.map((r: any) => ` ${glyph(r)} ${safeText(r.label)} · ${safeText(r.activity)}`),
    ...(active.length > rows.length ? [` … ${active.length - rows.length} more in Agent Hub`] : [])];
}

/** View state outlives overlays but not the parent Pi runtime. Editors retain
 * cursor, undo and paste registries independently for each recipient. */
export function createHubViewState(hub: any) {
  const state: any = { selectedId: undefined, mode: "roster", threads: new Map(), filter: "", disposed: false,
    tui: null, theme: null, repaint: () => {}, editorRows: 17, saved: new Map(), timers: new Map() };
  state.flush = (id?: string) => {
    const ids = id ? [id] : [...state.threads.keys()];
    for (const key of ids) {
      clearTimeout(state.timers.get(key)); state.timers.delete(key);
      const thread = state.threads.get(key);
      if (!thread?.editor) continue;
      const text = thread.editor.getExpandedText();
      if (state.saved.get(key) === text) continue;
      try { hub.history?.saveDraft(key, text); state.saved.set(key, text); }
      catch (error: any) { thread.notice = `Draft could not be saved: ${error.message}`; }
    }
  };
  state.thread = (id: string) => {
    if (state.threads.has(id)) return state.threads.get(id);
    const thread: any = { version: 0, follow: true, anchor: null, expanded: false, thinking: false, raw: false, notice: "", busy: false, recovered: new Set() };
    const host = new Proxy({}, { get: (_target, key) => key === "terminal"
      ? { rows: state.editorRows, columns: state.tui?.terminal?.columns || 80 }
      : key === "requestRender" ? () => state.repaint() : typeof state.tui?.[key] === "function" ? state.tui[key].bind(state.tui) : state.tui?.[key] });
    thread.editor = new Editor(host as any, {
      borderColor: (s: string) => state.theme.fg("borderAccent", s),
      selectList: { selectedPrefix: (s: string) => s, selectedText: (s: string) => s, description: (s: string) => s,
        scrollInfo: (s: string) => s, noMatch: (s: string) => s },
    });
    thread.editor.disableSubmit = true;
    thread.editor.onChange = () => {
      thread.version++;
      clearTimeout(state.timers.get(id));
      const timer = setTimeout(() => state.flush(id), 750); timer.unref?.(); state.timers.set(id, timer);
      state.repaint();
    };
    if (state.saved.has(id)) thread.editor.setText(state.saved.get(id));
    state.threads.set(id, thread); return thread;
  };
  state.dispose = () => { state.flush(); state.disposed = true; for (const timer of state.timers.values()) clearTimeout(timer); state.repaint = () => {}; };
  return state;
}

export class AgentHubView {
  private unsubscribe: () => void;
  private renderTimer: any;
  private closed = false;
  private focus = false;
  private transcripts = new Map<string, WorkerTranscript>();
  private menu: any[] = [];
  private menuIndex = 0;
  private returnMode = "roster";
  private confirmation: any;
  private contentOffset = 0;
  private search = new Input();
  private searchKind = "agents";
  private height = 24;
  private width = 80;
  constructor(private tui: any, private theme: any, private hub: any, private title: string, private done: (value?: any) => void,
    public state: any = createHubViewState(hub)) {
    state.tui = tui; state.theme = theme; state.repaint = () => this.requestRender();
    if (!state.selectedId) state.selectedId = this.records()[0]?.id;
    this.unsubscribe = hub.subscribe(() => {
      if (!state.selectedId) state.selectedId = this.records()[0]?.id;
      for (const record of hub.list()) {
        const thread = state.threads.get(record.id);
        if (!thread) continue;
        for (const receipt of record.receipts) {
          if (receipt.state !== "undelivered" || thread.recovered.has(receipt.id)) continue;
          thread.recovered.add(receipt.id);
          if (!thread.editor.getExpandedText()) thread.editor.setText(receipt.text);
          thread.notice = "Message was not delivered. Original text is retained in Messages (F2).";
        }
      }
      this.requestRender();
    });
    this.search.onSubmit = () => {
      if (this.searchKind === "agents") {
        state.flush(state.selectedId);
        state.filter = this.search.getValue(); state.mode = "roster";
        const visible = this.records();
        if (!visible.some((record: any) => record.id === state.selectedId)) state.selectedId = visible[0]?.id;
      }
      else { const thread = this.thread(); thread.raw = true; thread.searchQuery = this.search.getValue(); state.mode = "thread"; }
      this.requestRender();
    };
  }
  get focused() { return this.focus; }
  set focused(value: boolean) { this.focus = value; const thread = this.state.threads.get(this.state.selectedId); if (thread) thread.editor.focused = value && this.state.mode === "thread"; }
  private requestRender() {
    if (this.closed || this.renderTimer) return;
    this.renderTimer = setTimeout(() => { this.renderTimer = undefined; if (!this.closed) this.tui.requestRender(); }, 33);
    this.renderTimer.unref?.();
  }
  private record() { return this.hub.get(this.state.selectedId); }
  private thread() { return this.state.thread(this.state.selectedId); }
  private records() { const needle = this.state.filter.toLocaleLowerCase(); return this.hub.list().filter((r: any) => !needle || `${r.label} ${r.role} ${r.metadata?.task || ""}`.toLocaleLowerCase().includes(needle)); }
  private transcript(record: any) {
    if (!this.transcripts.has(record.id)) {
      this.transcripts.set(record.id, new WorkerTranscript({ ...this.tui, requestRender: () => this.requestRender() }, record.metadata?.cwd || process.cwd()));
      if (this.transcripts.size > 4) { const first = this.transcripts.keys().next().value; this.transcripts.get(first!)?.dispose(); this.transcripts.delete(first!); }
    }
    return this.transcripts.get(record.id)!;
  }
  private move(delta: number) {
    const records = this.records(); if (!records.length) return;
    this.state.flush(this.state.selectedId);
    const previous = this.state.threads.get(this.state.selectedId); if (previous) previous.editor.focused = false;
    const index = records.findIndex((r: any) => r.id === this.state.selectedId);
    this.state.selectedId = records[Math.max(0, Math.min(records.length - 1, (index < 0 ? 0 : index) + delta))].id;
    this.contentOffset = 0; if (this.state.mode === "thread") void this.hub.load(this.state.selectedId);
    this.requestRender();
  }
  private openThread() { if (!this.record()) return; this.state.mode = "thread"; void this.hub.load(this.state.selectedId); this.requestRender(); }
  private close(value?: any) {
    if (this.closed) return;
    this.state.flush(); if (!["thread", "roster"].includes(this.state.mode)) this.state.mode = this.returnMode;
    this.done(value);
  }
  private back() {
    this.state.flush(this.state.selectedId);
    if (this.state.mode === "roster") this.close();
    else if (this.state.mode === "thread") this.state.mode = "roster";
    else this.state.mode = this.returnMode;
    this.requestRender();
  }

  async send(mode = "steer") {
    const record = this.record(); if (!record) return;
    const id = record.id, thread = this.thread(), text = thread.editor.getExpandedText(), version = thread.version;
    if (!text.trim() || thread.busy) return;
    thread.busy = true; thread.notice = `Sending to ${record.label}…`; this.state.flush(id); this.requestRender();
    try {
      if (thread.newFollowUp) {
        await this.hub.readOnlyFollowUp(record, text);
        thread.newFollowUp = false; thread.notice = "Read-only follow-up finished; its separate thread is in Agents.";
      } else {
        const receipt = await this.hub.send(id, text, mode);
        thread.notice = receipt.state === "delivered" ? "Delivered to this agent's context." : "Queued; the current tool batch continues until the next delivery boundary.";
      }
      // Never clear newer input, or input belonging to another recipient.
      if (thread.version === version && thread.editor.getExpandedText() === text) { thread.editor.addToHistory(text); thread.editor.setText(""); }
      this.state.flush(id);
    } catch (error: any) { thread.notice = `Not delivered: ${safeText(error.message)} Your draft is preserved.`; }
    finally { thread.busy = false; this.requestRender(); }
  }

  private async perform(action: any) {
    try { await action.run(); }
    catch (error: any) { this.thread().notice = safeText(error.message); this.state.mode = this.returnMode; }
    this.requestRender();
  }
  private actions() {
    const record = this.record(), id = record?.id;
    this.returnMode = this.state.mode === "thread" ? "thread" : "roster";
    const back = () => { this.state.mode = this.returnMode; };
    this.menu = [];
    for (const question of this.hub.questions()) this.menu.push({ label: `Answer · ${question.title}`, run: () => this.close({ answer: question.id }) });
    if (record) {
      this.menu.push({ label: "Inspect task, parent, outcome and context", run: () => { this.contentOffset = 0; this.state.mode = "details"; } });
      this.menu.push({ label: "Messages: delivery receipts and recoverable text", run: () => { this.contentOffset = 0; this.state.mode = "messages"; } });
      if (record.controls.send) this.menu.push({ label: "Send draft after the current task (follow-up)", run: () => { back(); return this.send("followUp"); } });
      if (record.controls.cancelQueued) this.menu.push({ label: "Cancel queued messages (retain their text)", run: () => { record.controls.cancelQueued(); back(); } });
      if (record.controls.stop) this.menu.push({ label: `Stop ${record.label}…`, run: () => {
        this.confirmation = { title: `Stop ${record.label}?`, text: record.metadata?.workflowId
          ? "This worker and its nested calls will stop. The owning workflow run will halt. File changes remain; nothing is reverted."
          : "This worker and its nested calls will stop. Its caller may continue; unrelated agents are not stopped.", run: () => this.hub.abort(id) };
        this.menuIndex = 0; this.state.mode = "confirm";
      } });
      if (!running(record) && record.metadata?.producer === "dev-workflow") this.menu.push({ label: "Ask a NEW read-only follow-up (never replay this attempt)", run: () => { this.thread().newFollowUp = true; this.openThread(); } });
      this.menu.push({ label: "Toggle full raw evidence", run: () => { this.thread().raw = !this.thread().raw; this.openThread(); } });
      this.menu.push({ label: "Expand / collapse tool output", run: () => { this.thread().expanded = !this.thread().expanded; this.openThread(); } });
      this.menu.push({ label: "Show / hide provider-exposed thinking", run: () => { this.thread().thinking = !this.thread().thinking; this.openThread(); } });
      this.menu.push({ label: "Find text in full transcript", run: () => { this.searchKind = "transcript"; this.search.setValue(""); this.state.mode = "search"; } });
      this.menu.push({ label: "Copy full transcript", run: async () => { await this.hub.load(id); if (record.historyError) throw new Error(record.historyError); await copyToClipboard(safeText(rawTranscript(record))); back(); } });
      const undelivered = [...record.receipts].reverse().find((r: any) => ["undelivered", "cancelled"].includes(r.state));
      if (undelivered) this.menu.push({ label: "Restore latest undelivered/cancelled message to draft", run: () => {
        const thread = this.thread(); if (thread.editor.getExpandedText()) throw new Error("Keep or clear your current draft before restoring another message. Both texts remain available.");
        thread.editor.setText(undelivered.text); this.openThread();
      } });
    }
    const workflow = this.hub.workflow;
    if (workflow?.control) {
      if (["running", "pause requested"].includes(workflow.control.state)) this.menu.push({ label: "Pause workflow after the current operation", run: () => { workflow.control.pause(); back(); } });
      if (workflow.control.paused) this.menu.push({ label: "Continue paused workflow (revalidate first)", run: async () => { await workflow.control.resume(); back(); } });
      if (!workflow.control.signal.aborted && !["completed", "failed", "stopped"].includes(workflow.control.state)) this.menu.push({ label: "Stop workflow for manual edits / scope changes…", run: () => {
        this.confirmation = { title: "Stop this workflow?", text: "Cancels its workers and pending controller operations. Existing changes and checkpoints remain. Reconcile scope in Main before restarting.", run: () => workflow.control.stop() };
        this.menuIndex = 0; this.state.mode = "confirm";
      } });
      this.menu.push({ label: "Inspect controller commands and validation output", run: () => { this.contentOffset = 0; this.state.mode = "workflow"; } });
    }
    this.menu.push({ label: "Filter agents by purpose", run: () => { this.searchKind = "agents"; this.search.setValue(this.state.filter); this.state.mode = "search"; } });
    if (this.hub.history) this.menu.push({ label: "Load read-only history from earlier Main sessions", run: () => { this.hub.restore(this.hub.history.previous()); this.state.mode = "roster"; } });
    this.menuIndex = 0; this.state.mode = "actions"; this.requestRender();
  }

  handleInput(data: string) {
    if (matchesKey(data, "alt+a")) { this.close(); return; }
    if (matchesKey(data, "escape")) { this.back(); return; }
    if (matchesKey(data, "f1") || (this.state.mode === "roster" && data === "?")) {
      this.returnMode = this.state.mode === "thread" ? "thread" : "roster"; this.state.mode = "help"; this.contentOffset = 0; this.requestRender(); return;
    }
    if (this.height < 7 || this.width < 20) return; // Never accept invisible input in an unusably small viewport.
    if (matchesKey(data, "f2") && !["search", "confirm"].includes(this.state.mode)) { this.actions(); return; }
    if (this.state.mode === "search") { this.search.handleInput(data); this.requestRender(); return; }
    if (this.state.mode === "actions") {
      if (matchesKey(data, "up")) this.menuIndex = Math.max(0, this.menuIndex - 1);
      if (matchesKey(data, "down")) this.menuIndex = Math.min(this.menu.length - 1, this.menuIndex + 1);
      if (matchesKey(data, "enter")) void this.perform(this.menu[this.menuIndex]);
      this.requestRender(); return;
    }
    if (this.state.mode === "confirm") {
      if (matchesKey(data, "up") || matchesKey(data, "down") || matchesKey(data, "tab")) this.menuIndex = this.menuIndex ? 0 : 1;
      if (matchesKey(data, "enter")) { const action = this.confirmation; this.state.mode = this.returnMode; if (this.menuIndex === 1) void this.perform(action); }
      this.requestRender(); return;
    }
    if (["help", "details", "messages", "workflow"].includes(this.state.mode)) {
      const delta = matchesKey(data, "pageUp") ? -8 : matchesKey(data, "pageDown") ? 8 : matchesKey(data, "up") ? -1 : matchesKey(data, "down") ? 1 : 0;
      this.contentOffset = Math.max(0, this.contentOffset + delta); this.requestRender(); return;
    }
    if (this.state.mode === "roster") {
      if (matchesKey(data, "up") || data === "k") this.move(-1);
      else if (matchesKey(data, "down") || data === "j") this.move(1);
      else if (matchesKey(data, "enter")) this.openThread();
      else if (data === "/") { this.returnMode = "roster"; this.searchKind = "agents"; this.search.setValue(this.state.filter); this.state.mode = "search"; }
      this.requestRender(); return;
    }
    const record = this.record(); if (!record) return;
    const thread = this.thread();
    if (matchesKey(data, "alt+up")) this.move(-1);
    else if (matchesKey(data, "alt+down")) this.move(1);
    else if (matchesKey(data, "pageUp")) this.transcript(record).scroll(-Math.max(1, this.height - 10), thread);
    else if (matchesKey(data, "pageDown")) this.transcript(record).scroll(Math.max(1, this.height - 10), thread);
    else if (matchesKey(data, "alt+end")) { thread.follow = true; thread.anchor = null; }
    else if (matchesKey(data, "ctrl+o")) thread.expanded = !thread.expanded;
    else if (matchesKey(data, "ctrl+enter")) void this.send("followUp");
    else if (matchesKey(data, "enter")) void this.send();
    else if ((record.state === "working" && record.controls.send) || thread.newFollowUp) thread.editor.handleInput(data);
    this.requestRender();
  }

  private details(record: any) {
    if (!record) return "No selected agent.";
    const parent = this.hub.get(record.metadata?.parentId);
    const stats = record.stats || {}, ctx = record.context;
    return `${record.label}\n${record.state} · ${record.activity}\n${model(record)}\nElapsed: ${duration(record)}\nParent: ${parent?.label || record.metadata?.parentId || "Main"}\nRoot session: ${record.rootSessionId || "current"}\nWorktree: ${record.metadata?.cwd || "—"}\nContract: ${record.metadata?.contract || "—"}\nOutcome: ${record.outcome || "No controller acceptance recorded"}\n\n${record.error || record.historyError || ""}\n\nTASK\n${record.metadata?.task || "—"}\n\nCONTEXT\n${ctx?.percent === null || ctx?.percent === undefined ? "— (not currently measured)" : `${ctx.percent.toFixed(1)}% · ${compact(ctx.tokens)} / ${compact(ctx.contextWindow)}`}\n${record.metadata?.compaction || "Compaction not reported by producer"}\n\nUSAGE (this attempt)\n${compact(stats.totalTokens)} tokens · ${stats.requests || 0} responses · ${stats.tools || 0} tools\nInput ${compact(stats.input)} · Output ${compact(stats.output)} · Cache read ${compact(stats.cacheRead)}\nReported cost: ${stats.cost === null || stats.cost === undefined ? "—" : `$${stats.cost.toFixed(4)} (provider estimate; not a subscription charge)`}\n\nNative history: ${record.sessionFile || "not retained by producer"}`;
  }
  private help() {
    return "Agent Hub — Main is home; each child has its own conversation.\n\nAlt+A   Open / close the hub. Closing never stops work.\nEsc     Back one level. Drafts are retained.\nF1      This help. '?' is also available in the roster.\nF2      Available actions, questions, workflow controls and evidence.\n\nROSTER\n↑↓ or j/k  Choose an agent; new activity never reorders it.\nEnter      Open its thread.\n/          Filter by purpose.\n\nTHREAD\nEnter       Send to the named recipient. Current tools keep running.\nAlt+↑/↓     Switch threads; draft, cursor and history stay per thread.\nPgUp/PgDn   Read history without following new output.\nAlt+End     Jump back to live output.\nCtrl+O      Expand/collapse native tool output.\nCtrl+Enter  Queue after the current task (also available in F2).\nNormal editor keys and multiline paste work normally.\n\nDELIVERY\nQueued is not delivered. Delivered means added to agent context, not obeyed.\nF2 → Messages retains rejected/cancelled instructions and their exact text.\n\nCONTROL\nF2 → Pause stops the workflow at its next operation boundary.\nContinue rechecks the worktree and approved artifacts.\nStop does not undo file changes. Its confirmation names the affected owner.\nMain remains available for discussion; pause before competing edits.\n\nHISTORY\nFinished attempts are read-only, not automatically revived.\nAsk a new read-only follow-up explicitly; its result cannot replace the old one.\nF2 → Earlier history loads previous sessions without replaying any work.";
  }

  render(width: number): string[] {
    width = Math.max(1, Math.floor(width)); this.width = width; this.height = Math.max(1, Math.floor(this.tui.terminal?.rows || 24));
    const height = this.height, record = this.record(), mode = this.state.mode;
    if (height < 7 || width < 20) return [fit("Agent Hub", width), fit("Resize to compose safely", width), fit("Esc Back · F1 Help", width)].slice(0, height);
    const thread = record ? this.thread() : null;
    const header = this.theme.fg("accent", this.theme.bold("Agent Hub")) + this.theme.fg("muted", ` · ${mode === "thread" ? safeText(record?.label || "Unavailable thread") : "Agents"}`);
    const workflow = this.hub.workflow;
    const sub = workflow ? `${workflow.label} · ${workflow.control?.state || workflow.state} · ${workflow.control?.detail || workflow.detail || ""}` : "Main stays in the normal Pi console · Alt+A returns home";
    const questions = this.hub.questions();
    const notification = questions.length ? `${questions.length} request(s) need your input · F2 to answer; nothing is approved automatically`
      : record?.error || record?.historyError || (mode === "thread" ? thread?.notice : this.hub.lastUIError) || "";
    const footer = mode === "thread" ? "Enter Send · Esc Agents · F1 Help · F2 Actions" : mode === "roster" ? "↑↓ Choose · Enter Open · Esc Main · F1 Help · F2 Actions" : "↑↓ Navigate · Enter Select · Esc Back · F1 Help";
    const top = [fit(header, width), fit(this.theme.fg("muted", safeText(sub)), width)];
    if (notification) top.push(fit(this.theme.fg("warning", safeText(notification)), width));
    const foot = width >= 60 ? footer : "Esc Back · F1 Help · F2 Actions";
    let bodyHeight = height - top.length - 1;
    let body: string[] = [];
    if (mode === "thread" && record) {
      const writable = (record.state === "working" && !!record.controls.send) || thread.newFollowUp;
      this.state.editorRows = 17; // Native editor: at most five visible text lines.
      thread.editor.focused = this.focus && writable;
      let editorLines = writable ? thread.editor.render(width) : [];
      const maxEditor = Math.max(1, Math.min(7, bodyHeight - 3));
      if (editorLines.length > maxEditor) {
        const cursor = Math.max(0, editorLines.findIndex((l: string) => l.includes(CURSOR_MARKER)));
        const start = Math.max(1, Math.min(cursor, editorLines.length - maxEditor));
        editorLines = editorLines.slice(start, start + maxEditor);
      }
      const label = writable ? `To: ${thread.newFollowUp ? "NEW read-only follow-up to " : ""}${record.label}${thread.busy ? " · sending" : ""}` : "Read-only history · F2 for a new follow-up / full evidence";
      const count = Math.max(1, bodyHeight - editorLines.length - 2);
      if (!record.loaded) body = wrap(record.historyError || "Loading native history…", width).slice(0, count);
      else {
        const transcript = this.transcript(record);
        body = transcript.render(record, width, count, thread);
        if (thread.searchQuery) {
          thread.notice = transcript.find(thread.searchQuery, thread) ? `Found: ${thread.searchQuery}` : `Not found: ${thread.searchQuery}`;
          thread.searchQuery = ""; body = transcript.render(record, width, count, thread);
        }
      }
      while (body.length < count) body.push("");
      body.push(fit(this.theme.fg("dim", thread.follow ? "LIVE · PgUp reads history" : "READING HISTORY · Alt+End returns live"), width));
      body.push(fit(this.theme.fg(writable ? "accent" : "muted", safeText(label)), width), ...editorLines);
    } else if (mode === "roster") {
      const records = this.records(), index = records.findIndex((r: any) => r.id === this.state.selectedId);
      const wide = width >= 110 && bodyHeight >= 12;
      const leftWidth = wide ? Math.floor(width * 0.52) : width;
      const visible = Math.max(1, Math.floor(bodyHeight / 2));
      const start = Math.max(0, Math.min(Math.max(0, index) - Math.floor(visible / 2), Math.max(0, records.length - visible)));
      for (const r of records.slice(start, start + visible)) {
        const selected = r.id === this.state.selectedId;
        const first = `${selected ? "›" : " "} ${glyph(r)} ${safeText(r.label)}`;
        const parent = r.metadata?.parentId !== "main" ? ` ↳ ${this.hub.get(r.metadata?.parentId)?.label || "earlier thread"}` : "";
        const second = `  ${r.state} · ${model(r)} · ctx ${r.context?.percent == null ? "—" : `${r.context.percent.toFixed(0)}%`}${parent}`;
        for (const l of [first, safeText(second)]) body.push(selected ? this.theme.bg("selectedBg", pad(l, leftWidth)) : fit(l, leftWidth));
      }
      if (!records.length) body = wrap(this.state.filter ? "No matching agents. '/' changes the filter." : "No child agents yet. Explorers spawned from Main and workflow workers appear here automatically.", leftWidth);
      if (wide) {
        const rightWidth = width - leftWidth - 3;
        const details = wrap(safeText(this.details(record)), rightWidth);
        body = Array.from({ length: bodyHeight }, (_, i) => `${pad(body[i] || "", leftWidth)} ${this.theme.fg("borderMuted", "│")} ${fit(details[i] || "", rightWidth)}`);
      }
    } else if (mode === "actions") {
      const start = Math.max(0, this.menuIndex - Math.floor(bodyHeight / 2));
      body = this.menu.slice(start, start + bodyHeight).map((item, i) => `${start + i === this.menuIndex ? "›" : " "} ${safeText(item.label)}`);
    } else if (mode === "confirm") {
      // Reserve space for both choices; never accept a hidden destructive action.
      body = [...wrap(safeText(`${this.confirmation.title}\n${this.confirmation.text}`), width).slice(0, Math.max(0, bodyHeight - 3)), "",
        `${this.menuIndex === 0 ? "›" : " "} Cancel`, `${this.menuIndex === 1 ? "›" : " "} Confirm stop`];
    } else if (mode === "search") {
      this.search.focused = this.focus;
      body = [`Find ${this.searchKind === "agents" ? "agent purpose" : "in complete raw evidence"} · Enter apply · Esc cancel`, ...this.search.render(width)];
    } else {
      const text = mode === "help" ? this.help() : mode === "details" ? this.details(record) : mode === "messages"
        ? (record?.receipts || []).map((r: any) => `${r.state.toUpperCase()} · ${r.mode}\n${r.text}\n${r.error || ""}`).join("\n\n") || "No human messages for this attempt."
        : (workflow?.control?.operations || []).map((op: any) => `${op.state} · $ ${op.program} ${op.args.join(" ")}\n${op.stdout || ""}${op.stderr || ""}`).join("\n\n") || "No controller operations in this run.";
      const lines = wrap(safeText(text), width);
      this.contentOffset = Math.min(this.contentOffset, Math.max(0, lines.length - bodyHeight));
      body = lines.slice(this.contentOffset, this.contentOffset + bodyHeight);
    }
    while (body.length < bodyHeight) body.push("");
    return [...top, ...body.slice(0, bodyHeight), this.theme.fg("muted", fit(foot, width))].map(l => fit(l, width));
  }
  invalidate() { for (const t of this.transcripts.values()) t.invalidate(); }
  dispose() {
    if (this.closed) return; this.state.flush(); this.closed = true; clearTimeout(this.renderTimer); this.unsubscribe();
    this.state.repaint = () => {}; for (const t of this.transcripts.values()) t.dispose();
    for (const thread of this.state.threads.values()) thread.editor.focused = false;
  }
}

export function registerWorkerHubUI(pi: any, hub: any) {
  let ctx: any, view: AgentHubView | undefined, closeView: (() => void) | undefined, answering = false, disposed = false;
  const state = createHubViewState(hub);
  const renderWidget = () => {
    if (!ctx?.hasUI || disposed) return;
    const questions = hub.questions();
    const workflow = hub.workflow;
    const text = [...(workflow ? [`${workflow.label} · ${workflow.control?.state || workflow.state} · ${workflow.control?.detail || workflow.detail || ""}`] : []),
      ...(questions.length ? [`! ${questions.length} request(s) need your input · Alt+A then F2`] : []), ...compactWorkerLines(hub.list())];
    ctx.ui.setWidget("dev-workers", text.map((s: string) => safeText(s).replace(/\n/g, " ")));
  };
  const unsubscribe = hub.subscribe(renderWidget);
  const show = async (context = ctx) => {
    if (!context?.hasUI || disposed) return;
    if (answering) { context.ui.notify("Finish or cancel the open question before switching agents.", "info"); return; }
    if (closeView) { closeView(); return; }
    let result: any;
    try {
      result = await context.ui.custom((tui: any, theme: any, _keys: any, done: any) => {
        closeView = () => { state.flush(); done(); };
        view = new AgentHubView(tui, theme, hub, "session", done, state); return view;
      }, { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 } });
    } finally { view?.dispose(); view = undefined; closeView = undefined; }
    if (result?.answer && !disposed) {
      const question = hub.questions().find((q: any) => q.id === result.answer);
      if (!question) return;
      answering = true;
      try { await question.answer(context); } finally { answering = false; }
      if (!disposed) await show(context);
    }
  };
  pi.registerCommand("dev-workers", { description: "Open Agent Hub: inspect, message and control child threads", handler: async (_args: string, context: any) => { ctx = context; await show(context); } });
  pi.registerShortcut("alt+a", { description: "Toggle Agent Hub", handler: async (context: any) => { ctx = context; await show(context); } });
  pi.registerCommand("dev-attention", { description: "Answer the next explicit human request", handler: async (_args: string, context: any) => {
    const question = hub.questions()[0]; if (!question) { context.ui.notify("No pending requests.", "info"); return; }
    if (closeView) closeView(); answering = true;
    try { await question.answer(context); } finally { answering = false; }
  } });
  return {
    state,
    setContext(context: any) {
      ctx = context;
      if (hub.history && !state.restored) { for (const [id, draft] of hub.history.drafts()) state.saved.set(id, draft.text); state.restored = true; }
      renderWidget();
    },
    setWorkflow(title?: string) { if (title && title !== "session") hub.setWorkflow({ label: title, state: "running" }); renderWidget(); },
    open: show,
    dispose() { disposed = true; closeView?.(); state.dispose(); view?.dispose(); unsubscribe(); try { ctx?.ui.setWidget("dev-workers", undefined); } catch { /* parent runtime already closed */ } ctx = undefined; },
  };
}
