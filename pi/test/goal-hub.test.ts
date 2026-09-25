import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, TuiMainScreen, TuiAltScreen, Editor, type Terminal, type TUI } from "@earendil-works/pi-tui";
import { GoalHubView, goalHistory, openGoalHub } from "../lib/goal-hub.ts";

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
  assert.match(hub.render(100).join("\n"), /Replacement/);
  hub.handleInput("\r"); hub.handleInput("\u001b[B"); hub.handleInput("\r");
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

test("opening Goal Hub is read-only and uses the overlay with current branch goals", async () => {
  let options: { overlay?: boolean } | undefined;
  const manager = SessionManager.inMemory(process.cwd());
  manager.appendCustomEntry("dev-goal", { id: "goal-1", request: "Inspect", status: "Completed" });
  const before = manager.getBranch().length;
  const ui = { custom: async (factory: (tui: TUI, theme: Theme, keys: unknown, done: () => void) => GoalHubView,
    opts: { overlay?: boolean }) => {
    options = opts;
    const view = factory({ terminal: { rows: 30 }, requestRender: () => undefined } as unknown as TUI, theme, undefined, () => undefined);
    assert.match(view.render(100).join("\n"), /Inspect/);
  } };
  await openGoalHub({ mode: "tui", hasUI: true, sessionManager: manager, ui } as unknown as ExtensionContext);
  assert.equal(options?.overlay, true);
  assert.equal(manager.getBranch().length, before);
});

test("legacy goal records mark unavailable details instead of inventing evidence", () => {
  const tui = { terminal: { rows: 30 }, requestRender: () => undefined } as unknown as TUI;
  const view = new GoalHubView(tui, theme, [{ id: "legacy", request: "Old", status: "Paused", transitions: ["old"] }], () => undefined);
  view.handleInput("\r");
  assert.match(view.render(100).join("\n"), /unavailable \(legacy\)/);
});

test("roster previews the latest goal and timeline navigation never controls execution", () => {
  const goals = [
    { id: "old", request: "Prior goal", status: "Abandoned", timeline: [] },
    { id: "now", request: "Current goal", status: "Waiting", reason: "Human input needed", remaining: "Approve scope", dependency: "human: approval", timeline: [
      { at: 1000, kind: "foreground report", detail: "waiting for human" },
      { at: 2000, kind: "assessment", detail: "WAIT", assessment: { at: 2000, elapsedMs: 2, label: "model", status: "resolved", input: "report", raw: "WAIT" } },
    ] },
  ];
  let closed = 0;
  const tui = { terminal: { rows: 30 }, requestRender: () => undefined } as unknown as TUI;
  const view = new GoalHubView(tui, theme, goals, () => { closed++; });
  const roster = view.render(120).join("\n");
  assert.match(roster, /Current goal/); assert.match(roster, /Human input needed/);
  assert.match(roster, /Approve scope/); assert.match(roster, /\/dev-goal show/);
  view.handleInput("\r"); view.handleInput("\u001b[B"); view.handleInput("\r");
  assert.match(view.render(70).join("\n"), /Raw output: WAIT/);
  view.handleInput("\u001b");
  assert.match(view.render(70).join("\n"), /Current goal/);
  view.handleInput("\u001b"); assert.equal(closed, 1);
  assert.deepEqual(goals.map(g => g.status), ["Abandoned", "Waiting"]);
});

test("mouse selection and wheel follow roster rows without changing goals", () => {
  const goals = [{ id: "old", request: "Historical", status: "Completed" }, { id: "new", request: "Current", status: "Active" }];
  const view = new GoalHubView({ terminal: { rows: 24 }, requestRender: () => undefined } as unknown as TUI, theme, goals, () => undefined);
  const event = (x: number, y: number, clickCount = 1) => ({ type: "click" as const, button: "left" as const, x, y,
    screenX: x, screenY: y, width: 120, height: 24, shift: false, alt: false, ctrl: false, clickCount });
  view.render(120);
  view.handleMouse(event(5, 8)); assert.match(view.render(120).join("\n"), /historical goal/);
  view.handleMouse({ ...event(5, 8), type: "wheel", wheelDelta: -1 });
  assert.match(view.render(120).join("\n"), /latest goal/);
  view.handleMouse(event(5, 8, 2)); assert.match(view.render(120).join("\n"), /Timeline/);
  assert.deepEqual(goals.map(g => g.status), ["Completed", "Active"]);
});

test("long goal rosters, help and expanded assessment keep controls visible at small sizes", () => {
  const goals = Array.from({ length: 35 }, (_, i) => ({ id: String(i), request: `Goal ${i} with wide 字 🎯 and very long detail `.repeat(2), status: "Completed",
    timeline: Array.from({ length: 20 }, (_, j) => ({ at: 1000 + j, kind: "assessment", detail: `Event ${j} ` + "long ".repeat(30),
      assessment: { at: 1000 + j, elapsedMs: 1, label: "assessor", status: "resolved", input: "input ".repeat(100), raw: "output ".repeat(100) } })) }));
  const terminal = { rows: 24 };
  const tui = { terminal, requestRender: () => undefined } as unknown as TUI;
  const view = new GoalHubView(tui, theme, goals, () => undefined);
  for (const width of [20, 40, 80, 120]) for (const rows of [6, 12, 24]) {
    terminal.rows = rows;
    for (const lines of [view.render(width), (view.handleInput("\u001bOP"), view.render(width)), (view.handleInput("\u001b"), view.render(width))]) {
      assert.equal(lines.length, rows); assert.ok(lines.every(line => visibleWidth(line) <= width), `${width}x${rows}`);
      assert.match(lines.join("\n"), /Esc/);
      assert.doesNotMatch(lines.join("\n"), /Alt\+G/);
    }
  }
  terminal.rows = 24;
  view.handleInput("\r"); view.handleInput("\r");
  view.handleInput("\u001bOP"); assert.match(view.render(40).join("\n"), /Goal Hub · Help/);
  view.handleInput("\u001b"); assert.match(view.render(40).join("\n"), /Timeline/);
  view.render(40); view.handleInput("\u001b[6~");
  assert.match(view.render(40).join("\n"), /input|output/);
  view.handleInput("\u001b[5~");
  assert.match(view.render(40).join("\n"), /Goal Hub/);
});

class MemoryTerminal implements Terminal {
  rows = 24; columns = 80; kittyProtocolActive = false; output = "";
  input: (data: string) => void = () => undefined;
  resize: () => void = () => undefined;
  start(input: (data: string) => void, resize: () => void): void { this.input = input; this.resize = resize; }
  stop(): void {} drainInput(): Promise<void> { return Promise.resolve(); }
  write(data: string): void { this.output += data; }
  moveBy(_lines: number): void {} hideCursor(): void {} showCursor(): void {} clearLine(): void {} clearFromCursor(): void {}
  clearScreen(): void {} setTitle(_title: string): void {} setProgress(_active: boolean): void {}
}
for (const Renderer of [TuiMainScreen, TuiAltScreen]) test(`native ${Renderer.name}: Goal Hub leaves Main input untouched`, async () => {
  const terminal = new MemoryTerminal(), tui = new Renderer(terminal);
  const editorTheme = { borderColor: (s: string) => s, selectList: { selectedPrefix: (s: string) => s, selectedText: (s: string) => s,
    description: (s: string) => s, scrollInfo: (s: string) => s, noMatch: (s: string) => s } };
  const main = new Editor(tui, editorTheme); main.disableSubmit = true; main.setText("Main draft stays here");
  tui.addChild(main); tui.setFocus(main);
  let closed = 0;
  const view = new GoalHubView(tui, theme, [{ id: "g", request: "My goal", status: "Active" }], () => { closed++; overlay.hide(); tui.setFocus(main); });
  tui.start(); const overlay = tui.showOverlay(view, { width: "100%", maxHeight: "100%", margin: 0 }); tui.setFocus(view);
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    terminal.input("\r"); terminal.input("\u001b"); terminal.rows = 12; terminal.columns = 40; terminal.resize();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(view.render(40).every(line => visibleWidth(line) <= 40));
    assert.match(terminal.output, /Goal Hub/);
    terminal.input("\u001b"); await new Promise(resolve => setTimeout(resolve, 50));
    terminal.input("!"); assert.equal(closed, 1); assert.equal(main.getExpandedText(), "Main draft stays here!");
  } finally { overlay.hide(); tui.stop(); }
});
