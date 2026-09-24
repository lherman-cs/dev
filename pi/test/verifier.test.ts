import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createVerifierTool, candidateFingerprint } from "../lib/verifier.ts";
import { registerVerifier } from "../lib/verifier-hub.ts";
import { WorkerHub } from "../lib/worker-hub.ts";
import { WorkerHistory } from "../lib/worker-history.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { screen, viewFixture } from "./helpers/hub.ts";
import type { AsyncWorkerCompletion } from "../lib/worker.ts";

function fixture(t: TestContext): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "verify-test-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", cwd]);
  fs.writeFileSync(path.join(cwd, "source.txt"), "HEAD");
  execFileSync("git", ["add", "source.txt"], { cwd });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.org", "commit", "-qm", "initial"], { cwd });
  return cwd;
}

type Result = { status: string; candidate: string; cwd: string; results: { exit: number | null; command: string; excerpt: string }[]; log: string; detail?: string };
function launch(cwd: string) {
  let deliver!: (value: AsyncWorkerCompletion) => void;
  const delivered = new Promise<AsyncWorkerCompletion>(resolve => { deliver = resolve; });
  const { tool, cancelAll } = createVerifierTool(deliver);
  const execute = (commands: string[], extra: Record<string, unknown> = {}) => tool.execute("call", { commands, ...extra }, undefined, () => undefined, { cwd } as Parameters<typeof tool.execute>[4]);
  return { execute, delivered, cancelAll };
}

const unpack = (completion: AsyncWorkerCompletion): Result => JSON.parse(completion.result) as Result;

test("Verifier returns a receipt before a long dirty-candidate run, then delivers compact evidence and logs", async t => {
  const cwd = fixture(t);
  fs.writeFileSync(path.join(cwd, "source.txt"), "dirty");
  fs.writeFileSync(path.join(cwd, "untracked.txt"), "included");
  const expected = candidateFingerprint(cwd);
  const run = launch(cwd);
  let finished = false;
  void run.delivered.then(() => { finished = true; });
  const command = `node -e 'const fs=require("fs"); if(fs.readFileSync("source.txt","utf8")!=="dirty" || fs.readFileSync("untracked.txt","utf8")!=="included") process.exit(9); setTimeout(()=>{console.log("actual dirty candidate"); process.exit(0)},220)'`;
  const receipt = await run.execute([command]);
  assert.match(receipt.content[0]?.type === "text" ? receipt.content[0].text : "", /Verifier .* started/);
  assert.equal(finished, false, "launch must not await check completion");
  // Unrelated foreground work remains possible while the check runs.
  assert.equal(fs.readFileSync(path.join(cwd, "source.txt"), "utf8"), "dirty");
  const completion = await run.delivered;
  const evidence = unpack(completion);
  assert.equal(completion.status, "completed");
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.candidate, expected);
  assert.equal(evidence.cwd, cwd);
  assert.equal(evidence.results[0]?.exit, 0);
  assert.match(fs.readFileSync(evidence.log, "utf8"), /actual dirty candidate/);
  assert.equal(evidence.results[0]?.excerpt, "", "passing logs stay out of compact completion");
});

test("missing prerequisite, nonzero exit and timeout remain distinct non-passing outcomes", async t => {
  const cwd = fixture(t);
  const missing = launch(cwd);
  await missing.execute(["echo should-not-run"], { prerequisites: ["not-present"] });
  let result = unpack(await missing.delivered);
  assert.equal(result.status, "missing_prerequisite");
  assert.equal(result.results.length, 0);
  assert.ok(fs.existsSync(result.log));
  const failed = launch(cwd);
  await failed.execute(["echo useful-error >&2; exit 7", "echo should-not-run"]);
  result = unpack(await failed.delivered);
  assert.equal(result.status, "failed");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.exit, 7);
  assert.match(result.results[0]?.excerpt ?? "", /useful-error/);
  const timed = launch(cwd);
  await timed.execute(["exec sleep 5"], { timeoutMs: 40 });
  result = unpack(await timed.delivered);
  assert.equal(result.status, "timeout");
});

test("unavailable candidate reports interruption with a retained record, not a pass", async t => {
  const cwd = fixture(t);
  const run = launch(cwd);
  const receipt = await run.execute(["echo never-run"], { cwd: "missing-directory" });
  const evidence = unpack(await run.delivered);
  assert.equal(evidence.status, "interrupted");
  assert.equal(evidence.results.length, 0);
  const record = (receipt.details as { record: string }).record;
  assert.equal(JSON.parse(fs.readFileSync(record, "utf8")).status, "interrupted");
});

test("candidate drift invalidates an otherwise successful run", async t => {
  const cwd = fixture(t);
  const run = launch(cwd);
  const receipt = await run.execute(["node -e 'console.log(\"ready\"); setTimeout(()=>process.exit(0),300)'"]);
  const log = (receipt.details as { log: string }).log;
  await new Promise<void>((resolve, reject) => {
    const watcher = fs.watch(log, () => {
      if (fs.readFileSync(log, "utf8").includes("ready")) { watcher.close(); clearTimeout(timer); resolve(); }
    });
    const timer = setTimeout(() => { watcher.close(); reject(new Error("Verifier never started its command")); }, 2000);
  });
  fs.writeFileSync(path.join(cwd, "source.txt"), "changed while running");
  const evidence = unpack(await run.delivered);
  assert.equal(evidence.status, "candidate_drift");
  assert.match(evidence.detail ?? "", /changed/);
});

test("Verifier is visible live in Agent Hub, stoppable, and its full transcript survives restoration", async t => {
  const cwd = fixture(t);
  const sessions = fs.mkdtempSync(path.join(os.tmpdir(), "verify-sessions-"));
  t.after(() => fs.rmSync(sessions, { recursive: true, force: true }));
  const parent = SessionManager.create(cwd, sessions);
  const history = new WorkerHistory(parent);
  const hub = new WorkerHub({ history }); t.after(() => hub.dispose());
  const { view, state } = viewFixture(t, { hub });
  let deliver!: (completion: AsyncWorkerCompletion) => void;
  const delivered = new Promise<AsyncWorkerCompletion>(resolve => { deliver = resolve; });
  const { tool } = createVerifierTool(deliver, { observe(run, cancel) {
    const observer = registerVerifier(hub, history, run, cwd, cancel);
    return { ...observer, finish(status, outcome) { observer.finish(status === "cancelled" ? "aborted" : status === "passed" ? "completed" : "failed", outcome); } };
  } });
  const receipt = await tool.execute("call", { commands: ["node -e 'console.log(\"live output\"); setTimeout(() => console.log(\"done\"), 150)'" ] }, undefined, () => undefined, { cwd } as Parameters<typeof tool.execute>[4]);
  const { id, log } = receipt.details as { id: string; log: string };
  assert.equal(hub.get(id)?.role, "Verifier");
  assert.equal(hub.get(id)?.metadata["log"], log);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Verifier output did not arrive")), 2000);
    const unsubscribe = hub.subscribe(() => { if (hub.get(id)?.messages?.some(message => JSON.stringify(message).includes("live output"))) { clearTimeout(timer); unsubscribe(); resolve(); } });
  });
  state.selectedId = id; state.mode = "thread";
  assert.match(screen(view), /live output/);
  assert.match(screen(view), /Read-only/);
  assert.equal(hub.canSend(id), false);
  const completion = await delivered;
  assert.equal(completion.status, "completed");
  assert.equal(hub.get(id)?.state, "completed");
  assert.match(fs.readFileSync(log, "utf8"), /done/);
  const restored = new WorkerHub({ history }); t.after(() => restored.dispose());
  await history.restore(restored);
  assert.equal(restored.get(id)?.state, "completed");
  assert.match(JSON.stringify(restored.load(id).messages), /live output/);
  assert.match(JSON.stringify(restored.load(id).messages), /done/);
});

test("Agent Hub stop cancels verifier and marks the result non-passing", async t => {
  const cwd = fixture(t), hub = new WorkerHub(); t.after(() => hub.dispose());
  let deliver!: (completion: AsyncWorkerCompletion) => void;
  const delivered = new Promise<AsyncWorkerCompletion>(resolve => { deliver = resolve; });
  const { tool } = createVerifierTool(deliver, { observe(run, cancel) {
    const observer = registerVerifier(hub, undefined, run, cwd, cancel);
    return { ...observer, finish(status, outcome) { observer.finish(status === "cancelled" ? "aborted" : "failed", outcome); } };
  } });
  const receipt = await tool.execute("call", { commands: ["exec sleep 5"] }, undefined, () => undefined, { cwd } as Parameters<typeof tool.execute>[4]);
  const { id } = receipt.details as { id: string };
  assert.equal(await hub.abort(id), true);
  const completion = await delivered;
  assert.equal(unpack(completion).status, "cancelled");
  assert.equal(hub.get(id)?.state, "aborted");
});

test("cancellation terminates the run without publishing passing evidence", async t => {
  const cwd = fixture(t);
  const run = launch(cwd);
  await run.execute(["exec sleep 5"]);
  run.cancelAll();
  const evidence = unpack(await run.delivered);
  assert.equal(evidence.status, "cancelled");
  assert.equal(evidence.results.length, 0);
});
