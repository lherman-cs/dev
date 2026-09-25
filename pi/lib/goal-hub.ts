import { matchesKey, truncateToWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
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

/** Observation only. Neither opening nor navigation calls goal controls. */
export class GoalHubView {
  private selected = 0;
  private event = 0;
  private expanded = false;
  private scroll = 0;
  private detail = false;
  private tui: TUI;
  private theme: Theme;
  private goals: GoalRecord[];
  private done: () => void;
  constructor(tui: TUI, theme: Theme, goals: GoalRecord[], done: () => void) {
    this.tui = tui; this.theme = theme; this.goals = goals; this.done = done;
  }
  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { if (this.detail) this.detail = false; else this.done(); }
    else if (matchesKey(data, "up")) { if (this.detail) this.event = Math.max(0, this.event - 1); else this.selected = Math.max(0, this.selected - 1); this.expanded = false; this.scroll = 0; }
    else if (matchesKey(data, "down")) { if (this.detail) this.event = Math.min((this.goals[this.selected]?.timeline?.length ?? 1) - 1, this.event + 1); else this.selected = Math.min(this.goals.length - 1, this.selected + 1); this.expanded = false; this.scroll = 0; }
    else if (matchesKey(data, "enter") || matchesKey(data, "return")) { if (this.detail) this.expanded = !this.expanded; else { this.detail = true; this.event = 0; } this.scroll = 0; }
    else if (matchesKey(data, "pageDown")) this.scroll += 10;
    else if (matchesKey(data, "pageUp")) this.scroll = Math.max(0, this.scroll - 10);
    this.tui.requestRender();
  }
  render(width: number): string[] {
    const w = Math.max(1, width - 4);
    const lines: string[] = [this.theme.fg("accent", " Goal Hub · current session"), this.theme.fg("muted", " ↑↓ select · Enter details/expand · PgUp/PgDn scroll · Esc back/close"), ""];
    if (!this.goals.length) lines.push(" No goals recorded in this session.");
    else if (!this.detail) {
      for (const [i, goal] of this.goals.entries()) lines.push(`${i === this.selected ? this.theme.fg("accent", " ›") : "  "} ${clean(goal.status)} · ${clean(goal.skill ?? "goal")} · ${clean(goal.request)}`);
    } else {
      const goal = this.goals[this.selected]!;
      lines.push(` ${clean(goal.status)} · ${clean(goal.id)} · ${clean(goal.skill ?? "goal")}`,
        ` Request: ${clean(goal.request)}`, ` Clarifications: ${clean(goal.clarifications?.join("; ") || "none")}`,
        ` Automation: ${goal.status === "Active" ? "allowed" : "stopped"} · Remaining: ${goal.remaining === undefined ? "unavailable (legacy)" : clean(goal.remaining ?? "none")}`,
        ` Dependency: ${goal.dependency === undefined ? "unavailable (legacy)" : clean(goal.dependency ?? "none")}`,
        ` Outcome: ${clean(goal.outcome ?? "none recorded")}`, " Timeline:");
      if (!goal.timeline?.length) lines.push("  Exact event and assessment details unavailable (legacy record).");
      for (const [i, e] of (goal.timeline ?? []).entries()) {
        lines.push(`${i === this.event ? this.theme.fg("accent", " ›") : "  "} ${stamp(e.at)} · ${clean(e.kind)} · ${clean(e.detail)}${e.action ? ` · ${clean(e.action)}` : ""}`);
        if (i === this.event && this.expanded && e.assessment) {
          const a = e.assessment;
          const following = (goal.timeline ?? []).slice(i + 1);
          const nextAssessment = following.findIndex(x => x.kind === "assessment");
          const action = (nextAssessment < 0 ? following : following.slice(0, nextAssessment)).find(x => x.action);
          lines.push(`    Model: ${clean(a.label)} · Start: ${stamp(a.at - a.elapsedMs)} · End: ${a.status === "loading" || a.status === "running" ? "pending" : stamp(a.at)}`,
            `    Status: ${clean(a.status)} · Decision: ${clean(a.disposition ?? "none")} · Failure: ${clean(a.code ?? "none")}`,
            `    Exact input: ${clean(a.input ?? "unavailable in this record; inspect assessment start")}`,
            `    Raw output: ${clean(a.raw ?? "unavailable")}`,
            `    Runtime action: ${clean(action?.detail ?? (a.status === "running" || a.status === "loading" ? "pending" : "unavailable"))}`);
        }
      }
    }
    const wrapped = lines.flatMap(line => wrapTextWithAnsi(line, w));
    const max = Math.max(5, this.tui.terminal.rows - 5);
    this.scroll = Math.min(this.scroll, Math.max(0, wrapped.length - max));
    return wrapped.slice(this.scroll, this.scroll + max).map(line => truncateToWidth(line, Math.max(1, width)));
  }
  invalidate(): void {}
}

export function registerGoalHub(pi: ExtensionAPI): void {
  pi.registerShortcut("alt+g", { description: "Goal Hub: inspect session goals and assessment timeline", handler: async ctx => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const goals = goalHistory(ctx);
    await ctx.ui.custom((tui, theme, _keys, done) => new GoalHubView(tui, theme, goals, () => done(undefined)),
      { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 } });
  } });
}
