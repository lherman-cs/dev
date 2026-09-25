import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { safeText } from "./worker-transcript.ts";

type Event = { at: number; kind: string; detail: string; assessment?: { status: string; label: string; at: number; elapsedMs: number;
  input?: string; raw?: string; disposition?: string; code?: string }; action?: string };
export type GoalRecord = { id: string; request: string; skill?: string; status: string; reason?: string; remaining?: string | null;
  dependency?: string | null; outcome?: string; clarifications?: string[]; timeline?: Event[]; transitions?: string[]; stages?: unknown[] };
/** Branch-local snapshots preserve terminal and replaced goals without external storage. */
export function goalHistory(ctx: ExtensionContext): GoalRecord[] {
  const records = new Map<string, GoalRecord>();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== "dev-goal" || !entry.data || typeof entry.data !== "object") continue;
    const value = entry.data as Partial<GoalRecord>;
    if (typeof value.id !== "string" || typeof value.request !== "string" || typeof value.status !== "string") continue;
    records.set(value.id, value as GoalRecord);
  }
  return [...records.values()];
}
const clean = (value: unknown) => safeText(String(value ?? "")).replace(/[\r\n\t]+/g, " ");
const stamp = (at: number) => Number.isFinite(at) ? new Date(at).toISOString() : "unknown time";
const pad = (text: string, width: number) => { const trimmed = truncateToWidth(text, width); return trimmed + " ".repeat(Math.max(0, width - visibleWidth(trimmed))); };
const wrap = (text: string, width: number) => wrapTextWithAnsi(text, Math.max(1, width));
const recorded = (value: string | null | undefined) => value === undefined ? "unavailable (legacy)" : value === null ? "none" : clean(value);
const color = (status: string): "accent" | "success" | "warning" | "error" => status === "Completed" ? "success" : status === "Error" ? "error" : ["Waiting", "Paused", "Classifying"].includes(status) ? "warning" : "accent";
const symbol = (status: string) => status === "Completed" ? "✓" : status === "Abandoned" ? "×" : status === "Active" ? "●" : "○";

/** Read-only inspection of the branch's goal snapshots. Goal control stays in Main via /dev-goal. */
export class GoalHubView {
  private selected = 0;
  private event = 0;
  private expanded = false;
  private scroll = 0;
  private mode: "roster" | "timeline" | "help" = "roster";
  private helpFrom: "roster" | "timeline" = "roster";
  private hits: { index: number; y0: number; y1: number; x1: number }[] = [];
  private tui: TUI;
  private theme: Theme;
  private goals: GoalRecord[];
  private done: () => void;
  constructor(tui: TUI, theme: Theme, goals: GoalRecord[], done: () => void) {
    this.tui = tui; this.theme = theme; this.goals = [...goals].reverse(); this.done = done;
  }
  private current() { return this.goals[this.selected]; }
  private back() {
    if (this.mode === "help") this.mode = this.helpFrom;
    else if (this.mode === "timeline") this.mode = "roster";
    else { this.done(); return; }
    this.scroll = 0; this.tui.requestRender();
  }
  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.back(); return; }
    if (matchesKey(data, "f1") || (this.mode === "roster" && data === "?")) {
      if (this.mode === "help") this.mode = this.helpFrom;
      else { this.helpFrom = this.mode; this.mode = "help"; }
      this.scroll = 0; this.tui.requestRender(); return;
    }
    if (this.mode === "help") {
      if (matchesKey(data, "pageDown") || matchesKey(data, "down")) this.scroll += 5;
      else if (matchesKey(data, "pageUp") || matchesKey(data, "up")) this.scroll = Math.max(0, this.scroll - 5);
    } else if (this.mode === "roster") {
      if (matchesKey(data, "up") || data === "k") this.selected = Math.max(0, this.selected - 1);
      else if (matchesKey(data, "down") || data === "j") this.selected = Math.min(Math.max(0, this.goals.length - 1), this.selected + 1);
      else if (matchesKey(data, "enter") && this.current()) {
        this.mode = "timeline"; this.event = 0; this.expanded = false;
      }
      this.scroll = this.mode === "timeline" ? -1 : 0;
    } else {
      const count = this.current()?.timeline?.length ?? 0;
      if (matchesKey(data, "up") || data === "k") { this.event = Math.max(0, this.event - 1); this.scroll = -1; }
      else if (matchesKey(data, "down") || data === "j") { this.event = Math.min(Math.max(0, count - 1), this.event + 1); this.scroll = -1; }
      else if (matchesKey(data, "enter") && count) { this.expanded = !this.expanded; this.scroll = -1; }
      else if (matchesKey(data, "pageDown")) this.scroll = Math.max(0, this.scroll) + 10;
      else if (matchesKey(data, "pageUp")) this.scroll = Math.max(0, this.scroll - 10);
    }
    this.tui.requestRender();
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      if (this.mode === "roster") this.selected = Math.max(0, Math.min(this.goals.length - 1, this.selected + (event.wheelDelta && event.wheelDelta < 0 ? -1 : 1)));
      else this.scroll = Math.max(0, this.scroll + (event.wheelDelta && event.wheelDelta < 0 ? -3 : 3));
      this.tui.requestRender(); return { handled: true };
    }
    if (event.type !== "click" || event.button !== "left" || this.mode !== "roster") return;
    const hit = this.hits.find(h => event.y >= h.y0 && event.y < h.y1 && event.x >= 0 && event.x < h.x1);
    if (!hit) return;
    this.selected = hit.index;
    if (event.clickCount && event.clickCount >= 2) this.handleInput("\r");
    else this.tui.requestRender();
    return { handled: true, focus: true };
  }
  private roster(width: number, height: number): string[] {
    if (!this.goals.length) return ["No goals recorded in this session.", "Start one in Main with /dev-goal start <request> or /dev-build <request>."].flatMap(line => wrap(line, width));
    const active = this.goals.filter(g => !["Completed", "Abandoned"].includes(g.status)).length;
    if (height < 7) {
      this.hits.push({ index: this.selected, y0: 1, y1: 1 + height, x1: width });
      const g = this.current()!;
      return [`› ${symbol(g.status)} ${clean(g.request)}`, `${clean(g.status)} · ${this.selected + 1}/${this.goals.length} newest first`, `State: ${clean(g.reason || g.outcome || "No update recorded")}`];
    }
    const lines = [this.theme.fg("accent", `${this.goals.length} goals · ${active} unfinished · most recent first`),
      this.theme.fg("muted", "Read-only · /dev-goal controls in Main · Enter opens timeline"), ""];
    // Bound the roster to the visible height. The selection remains visible even with many goals.
    const size = Math.max(1, Math.floor((height - lines.length) / 3));
    const start = Math.max(0, Math.min(this.selected - Math.floor(size / 2), this.goals.length - size));
    lines.push(this.theme.fg("accent", `Showing ${start + 1}–${Math.min(start + size, this.goals.length)}/${this.goals.length}`));
    for (const [offset, goal] of this.goals.slice(start, start + size).entries()) {
      const chosen = start + offset === this.selected;
      this.hits.push({ index: start + offset, y0: 1 + lines.length, y1: 1 + lines.length + 3, x1: width });
      const mark = this.theme.fg(color(goal.status), symbol(goal.status));
      lines.push(`${chosen ? this.theme.fg("accent", "›") : " "} ${mark} ${clean(goal.request)}`,
        `    ${clean(goal.status)} · ${goal.skill ? `dev-${clean(goal.skill)}` : "explicit goal"}${start + offset === 0 ? " · latest" : " · history"}`,
        `    ${clean(goal.reason || goal.outcome || "No update recorded")}`);
    }
    return lines;
  }
  private summary(width: number): string[] {
    const g = this.current(); if (!g) return ["Select a goal to inspect it."];
    const lines = [this.theme.fg("accent", clean(g.request)),
      `${this.theme.fg(color(g.status), `${symbol(g.status)} ${clean(g.status)}`)} · ${g.skill ? `dev-${clean(g.skill)}` : "explicit goal"}${this.selected === 0 ? " · latest goal" : " · historical goal"}`,
      `State: ${clean(g.reason || "No reason recorded")}`, "",
      "REQUEST", clean(g.request), "", "PROGRESS",
      `Remaining: ${recorded(g.remaining)}`,
      `Dependency: ${recorded(g.dependency)}`,
      `Outcome: ${clean(g.outcome ?? "none recorded")}`,
      `Clarifications: ${clean(g.clarifications?.join("; ") || "none")}`, "",
      `${g.timeline?.length ?? 0} recorded events · Enter opens timeline`,
      "Read-only here. /dev-goal show displays status; /dev-goal pause, resume and abandon are human controls."];
    return lines.flatMap(line => wrap(line, width));
  }
  private timeline(width: number): { lines: string[]; selectedLine: number } {
    const g = this.current()!, events = g.timeline ?? [];
    const lines = [this.theme.fg("accent", clean(g.request)),
      `${this.theme.fg(color(g.status), clean(g.status))} · ${g.skill ? `dev-${clean(g.skill)}` : "explicit goal"} · ${g.timeline?.length ?? 0} events`,
      `State: ${clean(g.reason ?? "No reason recorded")}`,
      `Remaining: ${recorded(g.remaining)} · Dependency: ${recorded(g.dependency)}`,
      `Outcome: ${clean(g.outcome ?? "none recorded")} · Clarifications: ${clean(g.clarifications?.join("; ") || "none")}`, "", "TIMELINE · oldest first"]
      .flatMap(line => wrap(line, width));
    if (!g.timeline?.length) lines.push(...wrap("Exact event and assessment details unavailable (legacy record or no events yet).", width));
    let selectedLine = 0;
    for (const [i, e] of events.entries()) {
      if (i === this.event) selectedLine = lines.length;
      lines.push(...wrap(`${i === this.event ? this.theme.fg("accent", "›") : " "} ${stamp(e.at)} · ${clean(e.kind)} · ${clean(e.detail)}${e.action ? ` · ${clean(e.action)}` : ""}`, width));
      if (i === this.event && this.expanded) {
        if (!e.assessment) lines.push(...wrap("    No assessor details for this event.", width));
        else {
          const a = e.assessment;
          const following = events.slice(i + 1);
          const next = following.findIndex(x => x.kind === "assessment");
          const action = (next < 0 ? following : following.slice(0, next)).find(x => x.action);
          for (const text of [
            `    Model: ${clean(a.label)} · Start: ${stamp(a.at - a.elapsedMs)} · End: ${a.status === "loading" || a.status === "running" ? "pending" : stamp(a.at)}`,
            `    Status: ${clean(a.status)} · Decision: ${clean(a.disposition ?? "none")} · Failure: ${clean(a.code ?? "none")}`,
            `    Exact input: ${clean(a.input ?? "unavailable in this record; inspect assessment start")}`,
            `    Raw output: ${clean(a.raw ?? "unavailable")}`,
            `    Runtime action: ${clean(action?.detail ?? (a.status === "running" || a.status === "loading" ? "pending" : "unavailable"))}`,
          ]) lines.push(...wrap(text, width));
        }
      }
    }
    return { lines, selectedLine };
  }
  render(width: number): string[] {
    width = Math.max(1, width);
    const height = Math.max(1, this.tui.terminal?.rows || 24);
    const title = this.mode === "timeline" ? `Goal Hub · Timeline ${this.selected + 1}/${this.goals.length}` : this.mode === "help" ? "Goal Hub · Help" : "Goal Hub · Current session";
    const header = [this.theme.fg("accent", title)];
    const hints = width < 45 ? this.mode === "help" ? "Esc back · /dev-goal show" : "↑↓ · Enter · Esc back" :
      this.mode === "timeline" ? "Esc goals · ↑↓ events · Enter inspect · PgUp/Dn read · F1 help" :
      this.mode === "help" ? "Esc back · PgUp/Dn read · /dev-goal show" : "Esc Main · ↑↓ goals · Enter timeline · F1 help";
    const footer = wrap(this.theme.fg("muted", height < 4 ? "Esc back" : hints), width).slice(0, height >= 4 ? 2 : 1);
    const available = Math.max(0, height - header.length - footer.length);
    let body: string[];
    this.hits = [];
    if (this.mode === "help") body = [
      "GOAL HUB · Read-only session goals", "",
      "/dev-goal opens this hub without pausing or changing a goal. Esc closes it.",
      "The latest goal appears first; older completed, abandoned and replaced goals stay in this branch's history.",
      "↑↓ selects a goal; Enter opens its event timeline. ↑↓ selects an event; Enter reveals exact assessor input/output and runtime action when recorded.",
      "PgUp/PgDn reads long timeline details. Esc returns to the previous view, then to Main.", "",
      "To see text status use /dev-goal show. To start, pause, resume or abandon use explicit /dev-goal arguments in Main. Opening this hub never runs those controls.",
    ].flatMap(line => wrap(line, width));
    else if (this.mode === "timeline") {
      const content = this.timeline(width);
      if (this.scroll < 0) this.scroll = Math.max(0, content.selectedLine - Math.max(2, Math.floor(available / 2)));
      this.scroll = Math.min(this.scroll, Math.max(0, content.lines.length - available));
      body = content.lines.slice(this.scroll, this.scroll + available);
    } else if (width >= 100 && this.goals.length) {
      const leftWidth = Math.floor((width - 3) * .45), rightWidth = width - 3 - leftWidth;
      const left = this.roster(leftWidth, available), right = this.summary(rightWidth);
      body = Array.from({ length: available }, (_, i) => `${pad(left[i] || "", leftWidth)} ${this.theme.fg("borderMuted", "│")} ${pad(right[i] || "", rightWidth)}`);
    } else body = this.roster(width, available);
    if (this.mode === "help") { this.scroll = Math.min(this.scroll, Math.max(0, body.length - available)); body = body.slice(this.scroll, this.scroll + available); }
    body = body.slice(0, available);
    while (body.length < available) body.push("");
    return [...header, ...body, ...footer].map(line => truncateToWidth(line, width));
  }
  invalidate(): void {}
}

export async function openGoalHub(ctx: ExtensionContext): Promise<void> {
  await ctx.ui.custom((tui, theme, _keys, done) => new GoalHubView(tui, theme, goalHistory(ctx), () => done(undefined)),
    { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 } });
}
