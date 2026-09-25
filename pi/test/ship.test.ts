import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { packageReviewedCandidate } from "../lib/ship.ts";
import type { RunWorker } from "../lib/worker.ts";

const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@example.test"]);
  fs.writeFileSync(path.join(root, "a.txt"), "base\n");
  git(root, ["add", "-A"]); git(root, ["commit", "-qm", "base"]);
  const baseline = git(root, ["rev-parse", "HEAD"]);
  git(root, ["switch", "-qc", "feature"]);
  fs.writeFileSync(path.join(root, "a.txt"), "candidate\n");
  fs.writeFileSync(path.join(root, "b.txt"), "new\n");
  git(root, ["add", "-A"]); git(root, ["commit", "-qm", "messy development history"]);
  return { root, baseline, candidate: git(root, ["rev-parse", "HEAD"]), candidateTree: git(root, ["rev-parse", "HEAD^{tree}"]) };
}

test("ship model sees only an isolated repository and host preserves exact reviewed tree", async t => {
  const f = fixture(t);
  const sourceHead = f.candidate;
  const run: RunWorker = async args => {
    assert.notEqual(path.resolve(args.cwd), path.resolve(f.root));
    assert.equal(git(args.cwd, ["remote"]), "");
    assert.equal(git(args.cwd, ["branch", "--show-current"]), "ship-work");
    assert.ok(!git(args.cwd, ["branch"]).includes("feature"));
    assert.deepEqual(args.tools, ["read", "grep", "find", "ls"]);
    const commit = args.scopedTools?.find(tool => tool.name === "ship_commit");
    assert.ok(commit);
    await commit.execute("commit", { message: "feat: package candidate", paths: ["a.txt", "b.txt"] }, undefined, undefined, { cwd: args.cwd } as never);
    return "done" as never;
  };

  const result = await packageReviewedCandidate({ cwd: f.root, name: "test", run });
  assert.match(result, /ship\/test/);
  assert.equal(git(f.root, ["branch", "--show-current"]), "feature");
  assert.equal(git(f.root, ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(git(f.root, ["rev-parse", "ship/test^{tree}"]), f.candidateTree);
  assert.equal(git(f.root, ["merge-base", "ship/test", "main"]), f.baseline);
  assert.equal(git(f.root, ["rev-list", "--count", "main..ship/test"]), "1");
});

test("ship rejects any model content drift before creating a shipping branch", async t => {
  const f = fixture(t);
  const run: RunWorker = async args => {
    fs.writeFileSync(path.join(args.cwd, "a.txt"), "mutated by model\n");
    const commit = args.scopedTools?.find(tool => tool.name === "ship_commit");
    assert.ok(commit);
    await commit.execute("commit", { message: "feat: wrong", paths: ["a.txt", "b.txt"] }, undefined, undefined, { cwd: args.cwd } as never);
    return "done" as never;
  };
  await assert.rejects(packageReviewedCandidate({ cwd: f.root, name: "drift", run }), /changed candidate content/);
  assert.throws(() => git(f.root, ["rev-parse", "--verify", "ship/drift"]));
  assert.equal(git(f.root, ["rev-parse", "HEAD^{tree}"]), f.candidateTree);
});

test("ship rejects uncommitted review repairs until the human commits them", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "a.txt"), "uncommitted repair\n");
  let called = false;
  const run: RunWorker = async () => { called = true; return "unused" as never; };
  await assert.rejects(packageReviewedCandidate({ cwd: f.root, name: "dirty", run }), /Prepare a clean committed candidate.*human owns integration and commits/);
  assert.equal(called, false);
});

test("ship refuses a candidate until the human integrates advanced local main", async t => {
  const f = fixture(t);
  git(f.root, ["switch", "-q", "main"]);
  fs.writeFileSync(path.join(f.root, "main.txt"), "later\n");
  git(f.root, ["add", "-A"]); git(f.root, ["commit", "-qm", "later main"]);
  git(f.root, ["switch", "-q", "feature"]);
  let called = false;
  const run: RunWorker = async () => { called = true; return "unused" as never; };
  await assert.rejects(packageReviewedCandidate({ cwd: f.root, name: "stale", run }), /main is not integrated.*Prepare and commit the integrated candidate.*return to dev-review if integration materially changes reviewed effects/);
  assert.equal(called, false);
});
