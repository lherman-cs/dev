import { Input, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const active = (record: any) => record.state === "working" || record.state === "aborting";
const shortModel = (value: string) => String(value || "model").replace(/^gpt-[\d.]+-/, "");
const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n || 0);
const age = (stamp: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - stamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
};
const pad = (text: string, width: number) => {
  const clipped = truncateToWidth(text, Math.max(1, width));
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};
const line = (text: string, width: number) => truncateToWidth(text, Math.max(1, width));
const cost = (n: number) => n ? (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`) : "$0";

const textOf = (content: any): string => typeof content === "string" ? content : Array.isArray(content)
  ? content.map(part => part.type === "text" ? part.text
    : part.type === "thinking" ? `thinking: ${part.thinking || part.text || ""}`
    : part.type === "toolCall" ? `→ ${part.name} ${JSON.stringify(part.arguments || {})}`
    : "").filter(Boolean).join("\n")
  : "";

export function workerLines(record: any): string[] {
  const lines: string[] = [];
  for (const message of record.messages || []) {
    if (message.role === "assistant") lines.push(...textOf(message.content).split("\n").filter(Boolean).map((value: string) => `assistant  ${value}`));
    else if (message.role === "user") {
      const body = textOf(message.content).replace(/\s+/g, " ").trim();
      if (body) lines.push(`you        ${body.slice(0, 320)}${body.length > 320 ? " …" : ""}`);
    } else if (message.role === "toolResult") {
      const raw = textOf(message.content);
      const body = raw.replace(/\s+/g, " ").trim().slice(0, 420);
      lines.push(`← ${message.toolName || "tool"}  ${body}${raw.length > 420 ? " …" : ""}`);
    }
  }
  return lines;
}

function stateGlyph(record: any, theme?: any): string {
  const glyph = record.state === "working" ? "●" : record.state === "aborting" ? "◐" : record.state === "completed" ? "✓" : record.state === "failed" ? "×" : "○";
  if (!theme) return glyph;
  const color = record.state === "working" ? "accent" : record.state === "completed" ? "success" : record.state === "failed" ? "error" : record.state === "aborting" ? "warning" : "muted";
  return theme.fg(color, glyph);
}

function statsLine(record: any) {
  const stats = record.stats || {};
  return `${fmt(stats.totalTokens)} tok · ${fmt(stats.tools)} tools · ${fmt(stats.requests)} req · ${cost(stats.cost || 0)}`;
}

export function compactWorkerLines(records: any[], title = "Agents"): string[] {
  const running = records.filter(active);
  if (!running.length) return [];
  const header = `${title}  ·  ${running.length} active  ·  Alt+A inspect`;
  return [header, ...running.slice(0, 4).map(record => `  ${stateGlyph(record)} ${record.label} · ${shortModel(record.model)} ${record.thinking} · ${record.activity}`)];
}

class AgentHubView {
  private selected = 0;
  private selectedId?: string;
  private mode: "roster" | "thread" = "roster";
  private scroll = 0;
  private unsubscribe: () => void;
  private notice = "";
  private input: Input;
  focused = true;

  constructor(private tui: any, private theme: any, private hub: any, private title: string, private done: () => void) {
    this.input = new Input({
      prompt: "› ",
      placeholder: "Message this worker…",
      placeholderStyle: (value: string) => theme.fg("dim", value),
    });
    this.input.onSubmit = value => {
      const text = value.trim();
      const record = this.current();
      if (!text || !record?.session || !active(record)) return;
      this.input.setValue("");
      this.notice = "Steering message queued";
      void this.hub.steer(record.id, text).catch((error: Error) => { this.notice = error.message; this.tui.requestRender(); });
      this.scroll = 0;
      this.tui.requestRender();
    };
    this.input.onEscape = () => this.back();
    this.unsubscribe = hub.subscribe(() => {
      this.syncSelection();
      if (this.scroll === 0) this.scroll = 0;
      tui.requestRender();
    });
    this.syncSelection();
  }

  private records() { return this.hub.list(); }
  private syncSelection() {
    const records = this.records();
    if (!records.length) { this.selected = 0; this.selectedId = undefined; return; }
    if (this.selectedId) {
      const index = records.findIndex((record: any) => record.id === this.selectedId);
      if (index >= 0) { this.selected = index; return; }
    }
    this.selected = Math.max(0, Math.min(this.selected, records.length - 1));
    this.selectedId = records[this.selected]?.id;
  }
  private current() { this.syncSelection(); return this.records()[this.selected]; }
  private move(delta: number) {
    const records = this.records();
    if (!records.length) return;
    this.selected = Math.max(0, Math.min(records.length - 1, this.selected + delta));
    this.selectedId = records[this.selected]?.id;
    this.scroll = 0;
    this.notice = "";
    this.tui.requestRender();
  }
  private openThread() {
    if (!this.current()) return;
    this.mode = "thread";
    this.scroll = 0;
    this.notice = "";
    this.input.focused = true;
    this.tui.requestRender();
  }
  private back() {
    if (this.mode === "thread") {
      this.mode = "roster";
      this.input.focused = false;
      this.notice = "";
      this.tui.requestRender();
    } else this.done();
  }
  private async stopCurrent() {
    const record = this.current();
    if (!record || !active(record)) return;
    this.notice = `Stopping ${record.label}…`;
    this.tui.requestRender();
    try { await this.hub.abort(record.id); } catch (error: any) { this.notice = error.message; }
    this.tui.requestRender();
  }
  private async followUp() {
    const record = this.current();
    const text = this.input.getValue().trim();
    if (!record?.session || !active(record) || !text) return;
    this.input.setValue("");
    this.notice = "Follow-up queued";
    try { await this.hub.followUp(record.id, text); } catch (error: any) { this.notice = error.message; }
    this.scroll = 0;
    this.tui.requestRender();
  }

  handleInput(data: string) {
    if (matchesKey(data, "alt+a")) { this.done(); return; }
    if (this.mode === "thread") {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.left)) { this.back(); return; }
      if (matchesKey(data, "alt+up")) { this.move(-1); return; }
      if (matchesKey(data, "alt+down")) { this.move(1); return; }
      if (matchesKey(data, Key.pageUp)) { this.scroll += 10; this.tui.requestRender(); return; }
      if (matchesKey(data, Key.pageDown)) { this.scroll = Math.max(0, this.scroll - 10); this.tui.requestRender(); return; }
      if (matchesKey(data, "ctrl+x")) { void this.stopCurrent(); return; }
      if (matchesKey(data, "ctrl+enter")) { void this.followUp(); return; }
      if (this.current()?.session && active(this.current())) this.input.handleInput(data);
      return;
    }
    if (matchesKey(data, Key.escape)) { this.done(); return; }
    if (matchesKey(data, Key.up) || data === "k") { this.move(-1); return; }
    if (matchesKey(data, Key.down) || data === "j") { this.move(1); return; }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.right)) { this.openThread(); return; }
    if (data === "x") { void this.stopCurrent(); return; }
  }

  private header(width: number) {
    const records = this.records();
    const running = records.filter(active).length;
    const recent = records.length - running;
    const stats = records.reduce((sum: any, record: any) => ({
      tokens: sum.tokens + (record.stats?.totalTokens || 0),
      tools: sum.tools + (record.stats?.tools || 0),
      cost: sum.cost + (record.stats?.cost || 0),
    }), { tokens: 0, tools: 0, cost: 0 });
    const name = this.theme.fg("accent", this.theme.bold("Agent Hub"));
    const summary = this.theme.fg("muted", `${running} active · ${recent} recent · ${fmt(stats.tokens)} tok · ${fmt(stats.tools)} tools · ${cost(stats.cost)}`);
    return line(`${name}  ${this.theme.fg("dim", "│")}  ${this.title}  ${this.theme.fg("dim", "│")}  ${summary}`, width);
  }

  private roster(width: number, height: number) {
    const records = this.records();
    if (!records.length) return [this.theme.fg("muted", "No child agents yet. Explorers and future workflow workers will appear here automatically.")];
    const per = 2;
    const visibleCount = Math.max(1, Math.floor(height / per));
    const start = Math.max(0, Math.min(this.selected - Math.floor(visibleCount / 2), Math.max(0, records.length - visibleCount)));
    const shown = records.slice(start, start + visibleCount);
    const lines: string[] = [];
    for (let local = 0; local < shown.length; local++) {
      const index = start + local, record = shown[local], selected = index === this.selected;
      const marker = selected ? this.theme.fg("accent", "›") : " ";
      const identity = `${marker} ${stateGlyph(record, this.theme)} ${this.theme.bold(record.label)}`;
      const badge = `${shortModel(record.model)} · ${record.thinking}`;
      const available = Math.max(8, width - visibleWidth(identity) - visibleWidth(badge) - 3);
      let first = `${identity} ${" ".repeat(Math.max(1, available))}${this.theme.fg("muted", badge)}`;
      first = pad(first, width);
      const meta = `    ${record.activity}  ${this.theme.fg("dim", "·")}  ${statsLine(record)}  ${this.theme.fg("dim", "·")} ${age(record.updatedAt || record.startedAt)} ago`;
      let second = pad(meta, width);
      if (selected) {
        first = this.theme.bg("selectedBg", first);
        second = this.theme.bg("selectedBg", second);
      } else second = this.theme.fg("muted", second);
      lines.push(first, second);
    }
    return lines;
  }

  private inspector(record: any, width: number, height: number) {
    if (!record) return [this.theme.fg("muted", "Select an agent to inspect it.")];
    const task = record.metadata?.task || record.metadata?.phase || "No task summary";
    const lines = [
      `${stateGlyph(record, this.theme)} ${this.theme.bold(record.label)}`,
      this.theme.fg("muted", `${record.role} · ${shortModel(record.model)} · ${record.thinking} · ${record.state}`),
      "",
      this.theme.fg("dim", "CURRENT"),
      line(record.activity, width),
      "",
      this.theme.fg("dim", "TASK"),
      line(task, width),
      "",
      this.theme.fg("dim", "USAGE"),
      statsLine(record),
      this.theme.fg("muted", `active for ${age(record.startedAt)}`),
      "",
      this.theme.fg("dim", "RECENT"),
    ];
    const recent = workerLines(record).slice(-Math.max(2, height - lines.length));
    return [...lines, ...recent.map(value => line(value, width))].slice(0, height);
  }

  private renderRoster(width: number, bodyHeight: number) {
    const wide = width >= 100;
    if (!wide) {
      const roster = this.roster(Math.max(1, width - 4), Math.max(2, bodyHeight - 2));
      const selected = this.current();
      return [
        this.theme.fg("dim", "  CHILD AGENTS"),
        ...roster.map(value => `  ${value}`),
        ...(selected ? ["", line(`  ${this.theme.fg("dim", "Selected")}  ${selected.activity} · ${statsLine(selected)}`, width)] : []),
      ].slice(0, bodyHeight);
    }
    const inner = Math.max(1, width - 5);
    const leftWidth = Math.max(40, Math.floor(inner * 0.48));
    const rightWidth = Math.max(34, inner - leftWidth - 3);
    const left = [this.theme.fg("dim", "CHILD AGENTS"), ...this.roster(leftWidth, bodyHeight - 1)];
    const right = [this.theme.fg("dim", "INSPECTOR"), ...this.inspector(this.current(), rightWidth, bodyHeight - 1)];
    const rows = Math.max(left.length, right.length, bodyHeight);
    const divider = this.theme.fg("borderMuted", "│");
    return Array.from({ length: Math.min(rows, bodyHeight) }, (_, i) => `  ${pad(left[i] || "", leftWidth)} ${divider} ${pad(right[i] || "", rightWidth)}`);
  }

  private renderThread(width: number, bodyHeight: number) {
    const record = this.current();
    if (!record) return [this.theme.fg("muted", "Worker is no longer available.")];
    const transcriptHeight = Math.max(3, bodyHeight - (record.session && active(record) ? 4 : 2));
    const transcript = workerLines(record);
    const end = Math.max(0, transcript.length - this.scroll);
    const start = Math.max(0, end - transcriptHeight);
    const shown = transcript.slice(start, end);
    const out = [
      line(`  ${stateGlyph(record, this.theme)} ${this.theme.bold(record.label)}  ${this.theme.fg("muted", `${shortModel(record.model)} · ${record.thinking} · ${record.state} · ${statsLine(record)}`)}`, width),
      this.theme.fg("borderMuted", "─".repeat(Math.max(1, width))),
      ...shown.map(value => line(`  ${value}`, width)),
    ];
    while (out.length < transcriptHeight + 2) out.push("");
    if (record.session && active(record)) {
      out.push(this.theme.fg("borderMuted", "─".repeat(Math.max(1, width))));
      out.push(...this.input.render(Math.max(1, width - 2)).map(value => ` ${value}`));
    }
    return out.slice(0, bodyHeight);
  }

  render(width: number): string[] {
    const height = Math.max(14, (process.stdout.rows || 32) - 2);
    const footer = this.mode === "roster"
      ? "↑↓/jk navigate  ·  Enter inspect  ·  x stop  ·  Esc/Alt+A close"
      : this.current()?.session && active(this.current())
        ? "type + Enter steer  ·  Alt+↑/↓ switch  ·  Ctrl+Enter follow-up  ·  PgUp/PgDn history  ·  Ctrl+X stop  ·  Esc agents"
        : "Alt+↑/↓ switch  ·  PgUp/PgDn history  ·  Esc agents  ·  Alt+A close";
    const bodyHeight = Math.max(4, height - 5);
    const body = this.mode === "roster" ? this.renderRoster(width, bodyHeight) : this.renderThread(width, bodyHeight);
    const lines = [
      this.theme.fg("border", "─".repeat(Math.max(1, width))),
      this.header(width),
      this.theme.fg("borderMuted", "─".repeat(Math.max(1, width))),
      ...body,
    ];
    while (lines.length < height - 1) lines.push("");
    if (this.notice) lines[height - 2] = line(` ${this.theme.fg("warning", this.notice)}`, width);
    lines.push(line(` ${this.theme.fg("dim", footer)}`, width));
    return lines.slice(0, height).map(value => line(value, width));
  }

  invalidate() {}
  dispose() { this.unsubscribe(); }
}

export function registerWorkerHubUI(pi: any, hub: any) {
  let ctx: any;
  let workflow = "session";
  let open = false;

  const renderWidget = () => {
    const records = hub.list();
    const lines = compactWorkerLines(records, "Agents");
    ctx?.ui.setWidget("dev-workers", lines.length ? lines : undefined);
  };
  const unsubscribe = hub.subscribe(renderWidget);

  const show = async (commandCtx?: any) => {
    const useCtx = commandCtx || ctx;
    if (!useCtx?.hasUI) return;
    if (open) return;
    open = true;
    try {
      await useCtx.ui.custom((_tui: any, theme: any, _keys: any, done: any) =>
        new AgentHubView(_tui, theme, hub, workflow, done), {
          overlay: true,
          overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 },
        });
    } finally { open = false; }
  };

  pi.registerCommand("dev-workers", {
    description: "Open Agent Hub",
    handler: async (_args: string, commandCtx: any) => { ctx = commandCtx; renderWidget(); await show(commandCtx); },
  });
  pi.registerShortcut("alt+a", {
    description: "Open Agent Hub",
    handler: async (commandCtx: any) => { ctx = commandCtx; renderWidget(); await show(commandCtx); },
  });

  return {
    setContext(nextCtx: any) { ctx = nextCtx; renderWidget(); },
    setWorkflow(title?: string) { workflow = title || "session"; renderWidget(); },
    open: show,
    dispose() { unsubscribe(); ctx?.ui.setWidget("dev-workers", undefined); ctx = undefined; },
  };
}

export { AgentHubView };
