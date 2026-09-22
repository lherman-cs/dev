import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { admitBuildHandoff, handoffFile, loadBuildHandoff, recordBuildHandoff } from "../lib/ship-handoff.ts";

const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
function fixture(t: TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-handoff-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git"), repo = path.join(root, "repo");
  git(root, "init", "--bare", remote); git(root, "init", "-b", "main", repo);
  git(repo, "config", "user.email", "test@example.com"); git(repo, "config", "user.name", "Test");
  fs.mkdirSync(path.join(repo, "plans"), { recursive: true }); fs.writeFileSync(path.join(repo, "plans/spec.md"), "# spec\n"); fs.writeFileSync(path.join(repo, "plans/plan.md"), "# plan\n"); fs.writeFileSync(path.join(repo, "work.txt"), "base\n");
  git(repo, "add", "."); git(repo, "commit", "-m", "feat: base"); git(repo, "remote", "add", "origin", remote); git(repo, "push", "-u", "origin", "main");
  git(repo, "checkout", "-b", "feature"); fs.writeFileSync(path.join(repo, "work.txt"), "candidate\n"); git(repo, "commit", "-am", "feat: candidate");
  return repo;
}
const request = { specPath: "plans/spec.md", planPath: "plans/plan.md", baseRef: "main", completedOutcomes: ["Handoff"], localChecks: [{ name: "test", command: "npm test", status: "passed" as const }], residualRisks: [], unresolvedDecisions: [] };

test("build handoff is atomic, HEAD-bound, and admits only clean matching identities", t => {
  const repo = fixture(t); const handoff = recordBuildHandoff(repo, request, 42);
  assert.equal(handoff.recordedAt, 42); assert.equal(handoff.candidate.branch.name, "feature"); assert.equal(handoff.approved.spec.path, "plans/spec.md");
  const file = handoffFile(repo); assert.deepEqual(loadBuildHandoff(repo), handoff); assert.deepEqual(admitBuildHandoff(repo), handoff);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(name => name.endsWith(".tmp")), []);
  fs.writeFileSync(path.join(repo, "unrelated.txt"), "uncommitted\n"); assert.throws(() => admitBuildHandoff(repo), /Worktree drifted/);
});

test("build handoff rejects unresolved decisions and stale artifact or HEAD identity", t => {
  const repo = fixture(t); recordBuildHandoff(repo, { ...request, unresolvedDecisions: ["Choose API"] }); assert.throws(() => admitBuildHandoff(repo), /unresolved human decisions/);
  fs.unlinkSync(handoffFile(repo)); recordBuildHandoff(repo, request); fs.writeFileSync(path.join(repo, "work.txt"), "new candidate\n"); git(repo, "commit", "-am", "feat: drift");
  assert.throws(() => admitBuildHandoff(repo), /Git identity drifted/);
});
