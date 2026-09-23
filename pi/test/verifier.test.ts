import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createVerifierTool, candidateFingerprint } from "../lib/verifier.ts";
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

test("cancellation terminates the run without publishing passing evidence", async t => {
  const cwd = fixture(t);
  const run = launch(cwd);
  await run.execute(["exec sleep 5"]);
  run.cancelAll();
  const evidence = unpack(await run.delivered);
  assert.equal(evidence.status, "cancelled");
  assert.equal(evidence.results.length, 0);
});
