import { test } from "node:test";
import assert from "node:assert/strict";
import { pushCandidate, rebaseCandidate, type GitRun } from "../lib/ship-git.ts";
import type { CandidateIdentity } from "../lib/ship-contracts.ts";

const head = "a".repeat(40), base = "b".repeat(40), remote = "c".repeat(40);
const candidate: CandidateIdentity = { repository: { root: "/r/.git", coordinate: "origin" }, worktree: "/r", branch: { name: "feature", head }, base: { ref: "main", oid: base }, remote: { name: "origin", url: "url", oid: remote } };
const fake = (responses: Record<string, string | Error>, calls: string[][]): GitRun => (_cwd, args) => { calls.push([...args]); const value = responses[args.join(" ")]; if (value instanceof Error) throw value; if (value === undefined) throw new Error(`unexpected git ${args.join(" ")}`); return value; };

test("rebase validates clean exact identities and base ancestry", () => {
  const calls: string[][] = [], git = fake({ "status --porcelain=v1 --untracked-files=all": "", "branch --show-current": "feature", "rev-parse HEAD": head, "rev-parse origin/main": base, [`rebase ${base}`]: "", [`merge-base --is-ancestor ${base} ${head}`]: "" }, calls);
  assert.deepEqual(rebaseCandidate(candidate, git), { before: head, after: head, base, rewritten: false });
  assert.ok(!calls.some(args => args.includes("merge")));
});

test("ordinary push verifies publication and rewritten push uses an exact lease", () => {
  const ordinaryCalls: string[][] = [], ordinary = fake({ "rev-parse HEAD": head, "status --porcelain=v1 --untracked-files=all": "", "push origin refs/heads/feature:refs/heads/feature": "" }, ordinaryCalls);
  let polls = 0; const ordinaryRun: GitRun = (cwd, args) => args[0] === "ls-remote" ? (++polls === 1 ? `${remote}\trefs/heads/feature` : `${head}\trefs/heads/feature`) : ordinary(cwd, args);
  assert.equal(pushCandidate(candidate, false, ordinaryRun).mode, "ordinary");
  const calls: string[][] = []; polls = 0; const leaseBase = fake({ "rev-parse HEAD": head, "status --porcelain=v1 --untracked-files=all": "", [`push --force-with-lease=refs/heads/feature:${remote} origin refs/heads/feature:refs/heads/feature`]: "" }, calls);
  const lease: GitRun = (cwd, args) => args[0] === "ls-remote" ? (++polls === 1 ? `${remote}\trefs/heads/feature` : `${head}\trefs/heads/feature`) : leaseBase(cwd, args);
  assert.equal(pushCandidate(candidate, true, lease).mode, "lease"); assert.ok(calls.some(args => args[0]?.startsWith("--force-with-lease=") || args[1]?.startsWith("--force-with-lease=")));
});

test("rewritten push stops on a lease race", () => {
  const changed = "d".repeat(40), git = fake({ "rev-parse HEAD": head, "status --porcelain=v1 --untracked-files=all": "", "ls-remote --heads origin refs/heads/feature": `${changed}\trefs/heads/feature` }, []);
  assert.throws(() => pushCandidate(candidate, true, git), /lease changed/);
});
