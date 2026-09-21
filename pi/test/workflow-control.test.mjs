import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WorkflowControl } from "../lib/workflow-control.mjs";
import { workflowFingerprint, save } from "../lib/workflow.mjs";
const tick = () => new Promise(resolve => setImmediate(resolve));

test("pause waits for a safe operation boundary and explicitly continues", async () => {
  const states = [], control = new WorkflowControl({ snapshot: async () => "stable", onChange: c => states.push(c.state) });
  control.pause(); let ran = false;
  const operation = control.operation("git", ["status"], async () => { ran = true; return { code: 0, stdout: "clean", stderr: "" }; });
  await tick(); assert.equal(control.paused, true); assert.equal(ran, false);
  assert.equal(await control.resume(), true); await operation;
  assert.equal(ran, true); assert.equal(control.operations[0].state, "passed");
  assert.ok(states.includes("pause requested")); assert.ok(states.includes("paused"));
});

test("manual edits while paused fail revalidation instead of reusing evidence", async () => {
  let fingerprint = "before";
  const control = new WorkflowControl({ snapshot: async () => fingerprint }); control.pause();
  const operation = control.operation("git", ["push"], async () => assert.fail("must not publish"));
  const rejected = assert.rejects(operation, /changed while paused/);
  await tick(); fingerprint = "after";
  await assert.rejects(control.resume(), /changed while paused/); await rejected;
  assert.equal(control.signal.aborted, true);
});

test("stop releases a paused latch and cancels waiting without dispatching new work", async () => {
  const control = new WorkflowControl(); control.pause();
  const paused = control.checkpoint(); const rejection = assert.rejects(paused, /stopped/);
  await tick(); control.stop(); await rejection;
  await assert.rejects(control.operation("git", ["push"], () => assert.fail("stopped")), /stopped/);
});

test("UI observers throwing cannot break controller sequencing", async () => {
  const control = new WorkflowControl({ onChange: () => { throw new Error("UI failed"); } });
  assert.equal((await control.operation("check", [], async () => ({ code: 0, stdout: "ok", stderr: "" }))).code, 0);
  control.finish("completed"); assert.equal(control.state, "completed");
});

test("real worktree fingerprint includes untracked contents and ignored contract semantics", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-fingerprint-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitignore"), "/plans/\n"); fs.writeFileSync(path.join(root, "code.rs"), "original\n");
  git("add", "."); git("commit", "-qm", "test: initial");
  const dir = path.join(root, "plans", "sample"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "spec.md"), "Status: APPROVED\nKeep behavior stable.\n");
  save(path.join(dir, "project.toon"), { status: "ready" });
  save(path.join(dir, "plans", "P001.toon"), { id: "P001", goal: "test", checks: ["true"] });
  const project = { root, dir }, h = { cwd: root, async exec() { throw new Error("must use raw path to avoid recursive pause"); },
    async rawExec(program, args) { return { code: 0, stdout: execFileSync(program, args, { cwd: root, encoding: "utf8" }), stderr: "" }; } };
  const first = await workflowFingerprint(h, project);
  fs.writeFileSync(path.join(root, "new.rs"), "alpha"); const second = await workflowFingerprint(h, project);
  fs.writeFileSync(path.join(root, "new.rs"), "beta"); const third = await workflowFingerprint(h, project);
  fs.appendFileSync(path.join(dir, "spec.md"), "Changed semantics\n"); const fourth = await workflowFingerprint(h, project);
  assert.equal(new Set([first, second, third, fourth]).size, 4);
  assert.equal(await workflowFingerprint(h, project), fourth);
});
