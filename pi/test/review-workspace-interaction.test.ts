import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { ReviewWorkspace } from "../lib/review-workspace.ts";
import { ReviewWorkspaceView } from "../review-workspace-ui.ts";
import { theme, keys, screen, tick } from "./helpers/hub.ts";

async function setup(t: import("node:test").TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), "review-interaction-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  writeFileSync(join(cwd, "candidate"), "reviewed\n"); git("add", "."); git("commit", "-qm", "candidate");
  const store = new ReviewWorkspace(cwd, join(cwd, ".git", "review.json")); await store.restore();
  await store.publish({ recommendation: "Approve the usable result after reviewing the risk",
    sections: [{ id: "outcome", title: "Usable result", kind: "outcome", body: "A practical improvement to the intended workflow." },
      { id: "evidence", title: "Checked evidence", kind: "evidence", body: "Tests passed. Human visual assessment is outstanding." },
      { id: "risk", title: "Residual risk", kind: "risk", body: "Small terminals need scrolling." }],
    decisions: [{ id: "small", subject: "Small terminal", kind: "risk", recommendation: "Waive constrained height", consequence: "Use PageDown for details" }] });
  const terminal = { rows: 28, columns: 100 };
  const tui = { terminal, requestRender() {} } as TUI;
  const sent: string[] = [];
  const view = new ReviewWorkspaceView(tui, theme, store, () => {}, (_id, subject, text) => sent.push(`${subject}: ${text}`), () => true);
  t.after(() => view.dispose());
  for (let attempt = 0; attempt < 100 && !screen(view, 100).includes("Current candidate"); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(screen(view, 100), /Current candidate/);
  const click = (label: string, width = 100) => {
    const rows = view.render(width).map(line => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""));
    const y = rows.findIndex(line => line.includes(`[${label}]`)); assert.ok(y >= 0, `missing ${label} in ${rows.join("\n")}`);
    const x = rows[y]!.indexOf(`[${label}]`) + 1;
    view.handleMouse({ type: "click", button: "left", x, y, screenX: x, screenY: y, width, height: terminal.rows, clickCount: 1 } as TuiMouseEvent);
  };
  return { store, view, click, sent, terminal };
}

test("mouse-only navigation and decision actions, keyboard text, and explicit approval", async t => {
  const { store, view, click, sent } = await setup(t);
  click("Detail"); assert.match(screen(view, 100), /practical improvement/);
  click("Discussion"); view.render(100);
  click("Ask / change"); view.handleInput("Will the small screen work?");
  assert.equal(store.state.drafts["outcome"], "Will the small screen work?");
  assert.equal(sent.length, 0);
  click("Decisions"); assert.match(screen(view, 100), /Small terminal/);
  click("Waive risk"); assert.match(screen(view, 100), /WAIVE RISK/);
  click("Cancel"); assert.equal(store.state.current?.decisions[0]?.status, "open");
  click("Waive risk"); click("Confirm");
  for (let attempt = 0; attempt < 100 && String(store.state.current?.decisions[0]?.status) !== "waived"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(store.state.current?.decisions[0]?.status, "waived");
  for (let attempt = 0; attempt < 100 && !screen(view, 100).includes("[Approve]"); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  click("Approve"); assert.equal(store.state.approval, undefined);
  click("Confirm");
  for (let attempt = 0; attempt < 100 && !store.state.approval; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(store.state.approval);
  assert.equal(store.state.drafts["outcome"], "Will the small screen work?");
});

test("keyboard action focus reaches risk waiver and approval without a mouse", async t => {
  const { view, store } = await setup(t);
  view.handleInput(keys.f3); view.render(100);
  view.handleInput("\x1b[Z"); // content -> actions
  assert.match(screen(view, 100), /›\[Ask \/ change\]/);
  const labels = ["Ask / change", "General", "Accept", "Waive risk"];
  for (let i = 1; i < labels.length; i++) view.handleInput(keys.right);
  assert.match(screen(view, 100), /›\[Waive risk\]/);
  view.handleInput(keys.enter); assert.match(screen(view, 100), /WAIVE RISK/);
  view.handleInput(keys.enter);
  for (let attempt = 0; attempt < 100 && String(store.state.current?.decisions[0]?.status) !== "waived"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(store.state.current?.decisions[0]?.status, "waived");
  // Approval appears only after a fresh candidate check.
  for (let attempt = 0; attempt < 100 && !screen(view, 100).includes("›[Approve]"); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  const rendered = screen(view, 100); assert.match(rendered, /›\[Approve\]/);
  view.handleInput(keys.enter);
  assert.match(screen(view, 100), /Confirm decision/);
  view.handleInput(keys.escape); assert.equal(store.state.approval, undefined);
  view.handleInput(keys.enter); view.handleInput(keys.enter);
  for (let attempt = 0; attempt < 100 && !store.state.approval; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(store.state.approval, screen(view, 100));
});
