import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { observeShip } from "../lib/ship-observe.ts";
import type { GitRun } from "../lib/ship-git.ts";

const head = "a".repeat(40), base = "b".repeat(40);
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-live-"));
  fs.writeFileSync(path.join(root, "spec.md"), "Status: APPROVED\n");
  fs.writeFileSync(path.join(root, "plan.md"), "Status: APPROVED\n");
  const git: GitRun = (_cwd, args) => {
    const key = args.join(" ");
    const values: Record<string, string> = {
      "rev-parse --show-toplevel": root, "rev-parse --path-format=absolute --git-common-dir": path.join(root, ".git"),
      "branch --show-current": "feature", "rev-parse HEAD": head, "remote get-url origin": "https://github.com/org/repo.git",
      "status --porcelain=v1 --untracked-files=all": "", "rev-parse refs/remotes/origin/main": base,
      [`merge-base --is-ancestor ${base} ${head}`]: "", [`log --format=%H %s ${base}..${head}`]: `${head} implement`,
      [`diff --stat ${base}...${head}`]: "file | 1 +",
    };
    if (!(key in values)) throw new Error(`Unexpected Git command: ${key}`);
    return values[key]!;
  };
  const gh = () => JSON.stringify({ default_branch: "main" });
  const graphql = () => JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } });
  return { root, git, gh, graphql, cleanup: () => fs.rmSync(root, { force: true, recursive: true }) };
}
test("self-base corrects to default without claiming provenance", () => {
  const f = fixture();
  try {
    const observed = observeShip(f.root, "spec.md", "plan.md", "feature", f);
    assert.equal(observed.candidate.base.ref, "main");
    assert.equal(observed.provenance, "unverified");
    assert.match(observed.corrections[0]!, /Self-base/);
  } finally { f.cleanup(); }
});
test("a matching older PR is retained, but conflicting targets stop", () => {
  const f = fixture();
  const older = "c".repeat(40);
  const graphql = () => JSON.stringify({ data: { repository: { pullRequests: { nodes: [
    { number: 7, url: "https://github.com/org/repo/pull/7", isDraft: true, headRefName: "feature", headRefOid: older, headRepository: { nameWithOwner: "org/repo" }, baseRefName: "main", baseRefOid: base },
  ] } } } });
  try {
    const observed = observeShip(f.root, "spec.md", "plan.md", undefined, { ...f, graphql });
    assert.equal(observed.targetSource, "existing_pr");
    assert.equal(observed.pullRequests[0]?.head.head, older);
  } finally { f.cleanup(); }
});
test("unapproved artifacts cannot enter live observation", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, "spec.md"), "Status: DRAFT\n");
    assert.throws(() => observeShip(f.root, "spec.md", "plan.md", undefined, f), /not approved/);
  } finally { f.cleanup(); }
});
