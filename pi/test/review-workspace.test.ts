import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { ReviewWorkspace } from "../lib/review-workspace.ts";
import { ReviewWorkspaceView } from "../review-workspace-ui.ts";
import { theme, keys, screen, tick } from "./helpers/hub.ts";

function fixture(t: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), "review-workspace-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  writeFileSync(join(cwd, "candidate.txt"), "initial\n"); git("add", "."); git("commit", "-qm", "initial");
  const store = new ReviewWorkspace(cwd, join(cwd, ".git", "review.json"));
  const sections = [{ id: "outcome", title: "Outcome", kind: "outcome" as const, body: "The feature is usable and scoped." },
    { id: "evidence", title: "Evidence", kind: "evidence" as const, body: "Focused checks pass; terminal walkthrough remains." },
    { id: "risk", title: "Risk", kind: "risk" as const, body: "Small viewport has limited space." }];
  const risk = { id: "tiny", subject: "Small terminal", kind: "risk" as const, recommendation: "Accept constrained layout", consequence: "Details require scrolling" };
  const publish = () => store.publish({ sections, decisions: [risk], recommendation: "Proceed after checking terminal layouts" });
  return { cwd, git, store, sections, risk, publish };
}

test("approval requires explicit current clean candidate and resolved decisions", async t => {
  const f = fixture(t); await f.store.restore();
  await f.publish(); assert.equal((await f.store.check()).current, true);
  await assert.rejects(f.store.approve(), /Resolve consequential/);
  await f.store.decide("tiny", "waived"); await f.store.approve(); assert.ok(f.store.state.approval);
  writeFileSync(join(f.cwd, "candidate.txt"), "modified\n");
  assert.equal((await f.store.check()).current, false); await assert.rejects(f.store.approve(), /unavailable/);
  f.git("add", "."); f.git("commit", "-qm", "changed");
  assert.equal((await f.store.check()).current, false); assert.ok(f.store.state.approval, "historical approval retained but cannot authorize changed candidate");
  await f.publish(); assert.ok(f.store.state.pending); assert.equal((await f.store.check()).current, false);
  await f.store.applyUpdate(); assert.equal((await f.store.check()).current, true);
  await assert.rejects(f.store.approve(), /Resolve consequential/);
});

test("restoration preserves drafts and version-bound discussions but revokes approval and uncertain submissions", async t => {
  const f = fixture(t); await f.store.restore(); const first = await f.publish();
  f.store.state.drafts["outcome"] = "A question not yet sent";
  const pending = await f.store.addHuman("outcome", "Why this architecture?");
  await f.store.decide("tiny", "accepted"); await f.store.approve();
  const again = new ReviewWorkspace(f.cwd, f.store.file); await again.restore();
  assert.equal(again.state.drafts["outcome"], "A question not yet sent");
  assert.equal(again.state.discussions[0]?.version, first.version);
  assert.equal(again.state.discussions[0]?.status, "failed");
  assert.equal(again.state.approval, undefined); assert.equal((await again.check()).current, false);
  await assert.rejects(again.answer(pending.id, "reply to an old request"), /not pending/);
  await again.publish({ sections: f.sections, decisions: [], recommendation: "Reconciled" });
  await again.applyUpdate(); assert.equal((await again.check()).current, true);
});

test("per-subject discussion and pending updates do not overwrite the reader's assessment", async t => {
  const f = fixture(t); await f.store.restore(); const first = await f.publish();
  const question = await f.store.addHuman("evidence", "What did the checks cover?");
  await f.store.answer(question.id, "Only current tests; no manual terminal run yet.");
  const next = await f.store.publish({ sections: [{ ...f.sections[0]!, body: "Updated outcome" }, ...f.sections.slice(1)], decisions: [], recommendation: "Revised" });
  assert.equal(f.store.state.current?.version, first.version); assert.equal(f.store.state.pending?.version, next.version);
  const later = await f.store.publish({ sections: [{ ...f.sections[0]!, body: "Later revision" }, ...f.sections.slice(1)], decisions: [], recommendation: "Later" });
  assert.equal(f.store.state.pending?.version, next.version, "new updates must not replace one under inspection");
  assert.equal(f.store.state.updates[0]?.version, later.version);
  assert.equal(f.store.state.discussions[1]?.subject, "evidence"); assert.equal(f.store.state.discussions[1]?.version, first.version);
  await f.store.applyUpdate(); assert.equal(f.store.state.current?.version, next.version);
  assert.equal(f.store.state.pending?.version, later.version);
  await f.store.applyUpdate(); assert.equal(f.store.state.current?.version, later.version);
});

test("failed delivery restores the current subject draft without resending it", async t => {
  const f = fixture(t); await f.store.restore(); await f.publish();
  const terminal = { rows: 28, columns: 80 }; const tui = { terminal, requestRender: () => {} } as TUI;
  let delivered = 0;
  const view = new ReviewWorkspaceView(tui, theme, f.store, () => {}, () => { delivered++; }, () => true);
  t.after(() => view.dispose()); await tick();
  view.handleInput(keys.f2); view.handleInput("\t"); view.handleInput("Please investigate"); view.handleInput(keys.enter);
  for (let attempt = 0; attempt < 100 && !delivered; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(delivered, 1);
  const message = f.store.state.discussions.find(m => m.author === "human"); assert.ok(message);
  await f.store.fail(message.id, "review agent stopped");
  assert.equal(f.store.state.drafts["outcome"], "Please investigate");
  assert.match(screen(view, 80), /Please investigate/);
  assert.equal(delivered, 1, "a failed request must never be replayed automatically");
});

test("a paused review marks undelivered requests failed without replay", async t => {
  const f = fixture(t); await f.store.restore(); await f.publish();
  const pending = await f.store.addHuman("outcome", "What was checked?");
  const terminal = { rows: 28, columns: 80 }; const tui = { terminal, requestRender: () => {} } as TUI;
  const view = new ReviewWorkspaceView(tui, theme, f.store, () => {}, () => assert.fail("must not send"), () => false);
  t.after(() => view.dispose());
  for (let attempt = 0; attempt < 100 && pending.status !== "failed"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pending.status, "failed");
  assert.equal(f.store.state.drafts["outcome"], "What was checked?");
  assert.match(screen(view, 80), /Not delivered/);
});

test("unreadable saved review discloses loss without inventing decisions", async t => {
  const f = fixture(t); writeFileSync(f.store.file, "not JSON"); await f.store.restore();
  assert.match(f.store.state.notice || "", /could not be read/);
  assert.equal(f.store.state.current, undefined);
  assert.equal(f.store.state.approval, undefined);
});

test("a changed integration baseline invalidates approval even when candidate HEAD is unchanged", async t => {
  const f = fixture(t); await f.store.restore(); await f.store.publish({ sections: f.sections, decisions: [], recommendation: "Proceed" });
  await f.store.approve(); assert.equal((await f.store.check()).current, true);
  f.git("branch", "next-main"); f.git("checkout", "-q", "next-main");
  writeFileSync(join(f.cwd, "baseline.txt"), "advanced\n"); f.git("add", "."); f.git("commit", "-qm", "advance");
  f.git("branch", "-f", "main", "HEAD"); f.git("checkout", "-q", "-");
  assert.equal((await f.store.check()).current, false);
  await assert.rejects(f.store.approve(), /unavailable/);
});

test("wide and narrow terminal views keep reading, decision controls and subject drafts reachable", async t => {
  const f = fixture(t); await f.store.restore(); await f.publish();
  const terminal = { rows: 28, columns: 100 }; const tui = { terminal, requestRender: () => {} } as TUI;
  let closed = 0; const sent: string[] = [];
  const view = new ReviewWorkspaceView(tui, theme, f.store, () => { closed++; }, (_id, _subject, text) => { sent.push(text); }, () => true);
  t.after(() => view.dispose()); await tick();
  for (const width of [32, 52, 80, 120]) for (const height of [12, 20, 28]) {
    terminal.rows = height;
    const lines = view.render(width);
    assert.ok(lines.length <= height && lines.every(line => visibleWidth(line) <= width), `${width}x${height}`);
    assert.match(screen(view, width), /REVIEW/);
  }
  terminal.rows = 28; view.handleInput(keys.enter); assert.match(screen(view, 80), /usable and scoped/);
  view.handleInput(keys.f2); assert.match(screen(view, 80), /Discussion/);
  view.handleInput("\t"); view.handleInput("Can we ship?");
  assert.equal(f.store.state.drafts["outcome"], "Can we ship?");
  view.handleInput(keys.escape); view.handleInput(keys.escape); assert.equal(closed, 0);
  view.handleInput(keys.escape); assert.equal(closed, 1);
  assert.deepEqual(sent, []);
});
