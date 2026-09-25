import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { GoalHubView, goalHistory, registerGoalHub } from "../lib/goal-hub.ts";

const theme = { fg: (_kind: string, value: string) => value } as Theme;
test("goal hub reads branch history, including replaced and abandoned goals, without writing", () => {
  const manager = SessionManager.inMemory(process.cwd());
  const first = { id: "old", request: "Original", skill: "spec", status: "Active", timeline: [] };
  manager.appendCustomEntry("dev-goal", first);
  manager.appendCustomEntry("dev-goal", { ...first, status: "Abandoned", clarifications: ["Add test"] });
  manager.appendCustomEntry("dev-goal", { id: "new", request: "Replacement", skill: "build", status: "Completed", outcome: "COMPLETE",
    remaining: null, dependency: null, timeline: [
      { at: 10000, kind: "foreground report", detail: "report" },
      { at: 10001, kind: "assessment", detail: "COMPLETE", assessment: { at: 10001, elapsedMs: 1, label: "assessor (test/model)", status: "resolved", input: "exact input", raw: "COMPLETE", disposition: "COMPLETE" } },
      { at: 10002, kind: "runtime", detail: "Whole goal complete", action: "completed" },
    ] });
  const ctx = { sessionManager: manager } as unknown as ExtensionContext;
  const before = manager.getBranch().length;
  const goals = goalHistory(ctx);
  assert.deepEqual(goals.map(g => [g.id, g.status]), [["old", "Abandoned"], ["new", "Completed"]]);
  let renders = 0, closed = 0;
  const tui = { terminal: { rows: 30 }, requestRender: () => { renders++; } } as unknown as TUI;
  const hub = new GoalHubView(tui, theme, goals, () => { closed++; });
  assert.match(hub.render(100).join("\n"), /Original/);
  hub.handleInput("\u001b[B"); hub.handleInput("\r");
  assert.match(hub.render(100).join("\n"), /Replacement/);
  hub.handleInput("\u001b[B"); hub.handleInput("\r");
  const details = hub.render(100).join("\n");
  assert.match(details, /exact input/); assert.match(details, /Raw output: COMPLETE/);
  assert.match(details, /Runtime action: Whole goal complete/);
  hub.handleInput("\u001b"); hub.handleInput("\u001b");
  assert.equal(closed, 1); assert.ok(renders > 0);
  assert.equal(manager.getBranch().length, before);
});

test("native session reopen retains historical goal snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "goal-hub-history-"));
  try {
    const file = join(root, "session.jsonl");
    writeFileSync(file, JSON.stringify(SessionManager.inMemory(root).getHeader()) + "\n");
    const manager = SessionManager.open(file);
    manager.appendCustomEntry("dev-goal", { id: "old", request: "First", status: "Abandoned" });
    manager.appendCustomEntry("dev-goal", { id: "new", request: "Second", status: "Completed" });
    const reopened = SessionManager.open(file);
    const history = goalHistory({ sessionManager: reopened } as unknown as ExtensionContext);
    assert.deepEqual(history.map(g => [g.id, g.status]), [["old", "Abandoned"], ["new", "Completed"]]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Alt-G is read-only and opens the overlay with current branch goals", async () => {
  let key = "", options: { overlay?: boolean } | undefined;
  let handler!: (ctx: ExtensionContext) => Promise<void>;
  registerGoalHub({ registerShortcut: (binding: string, entry: { handler: typeof handler }) => { key = binding; handler = entry.handler; } } as unknown as ExtensionAPI);
  const manager = SessionManager.inMemory(process.cwd());
  manager.appendCustomEntry("dev-goal", { id: "goal-1", request: "Inspect", status: "Completed" });
  const before = manager.getBranch().length;
  const ui = { custom: async (factory: (tui: TUI, theme: Theme, keys: unknown, done: () => void) => GoalHubView,
    opts: { overlay?: boolean }) => {
    options = opts;
    const view = factory({ terminal: { rows: 30 }, requestRender: () => undefined } as unknown as TUI, theme, undefined, () => undefined);
    assert.match(view.render(100).join("\n"), /Inspect/);
  } };
  await handler({ mode: "tui", hasUI: true, sessionManager: manager, ui } as unknown as ExtensionContext);
  assert.equal(key, "alt+g"); assert.equal(options?.overlay, true);
  assert.equal(manager.getBranch().length, before);
});

test("legacy goal records mark unavailable details instead of inventing evidence", () => {
  const tui = { terminal: { rows: 30 }, requestRender: () => undefined } as unknown as TUI;
  const view = new GoalHubView(tui, theme, [{ id: "legacy", request: "Old", status: "Paused", transitions: ["old"] }], () => undefined);
  view.handleInput("\r");
  assert.match(view.render(100).join("\n"), /unavailable \(legacy\)/);
});
