import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticateGitHub, createDraftPullRequest, fetchExactGitHubObject, mapRequiredContexts, markPullRequestReady, readRequiredContexts, type GhRun, type GraphqlRun } from "../lib/github-evidence.ts";
import type { CandidateIdentity, PullRequestIdentity } from "../lib/ship-contracts.ts";
const oid = "a".repeat(40), base = "b".repeat(40);
const candidate: CandidateIdentity = { repository: { root: "/r", coordinate: "git@github.com:o/r.git" }, worktree: "/r", branch: { name: "f", head: oid }, base: { ref: "main", oid: base }, remote: { name: "origin", url: "git@github.com:o/r.git" } };
const pr: PullRequestIdentity = { number: 1, url: "https://github.com/o/r/pull/1", state: "OPEN", draft: true, head: candidate.branch, base: candidate.base };

test("GitHub mutations authenticate, create only a draft, and expose no merge path", () => {
  const calls: string[][] = []; const run: GhRun = args => { calls.push([...args]); return args[1] === "user" ? "octo" : "url"; };
  const graphql: GraphqlRun = () => JSON.stringify({ data: { repository: { pullRequests: { nodes: [{ number: 1, url: pr.url, headRefName: "f", headRefOid: oid, headRepository: { nameWithOwner: "o/r" }, baseRefName: "main", baseRefOid: base, isDraft: true }] } } } });
  assert.equal(authenticateGitHub(run), "octo"); createDraftPullRequest(candidate, "Title", "Body", run); markPullRequestReady(pr, candidate, run, graphql);
  assert.ok(calls.some(args => args.includes("--draft"))); assert.ok(calls.some(args => args[0] === "pr" && args[1] === "ready")); assert.ok(!calls.flat().includes("merge"));
  assert.throws(() => markPullRequestReady({ ...pr, draft: false }, candidate, run), /identity changed/);
});

test("lost ready response is accepted only when the same exact PR is observed ready", () => {
  let draft = true, calls = 0;
  const run: GhRun = args => {
    if (args[1] === "user") return "octo";
    calls++; draft = false; throw new Error("connection lost");
  };
  const graphql: GraphqlRun = () => JSON.stringify({ data: { repository: { pullRequests: { nodes: [{ number: 1, url: pr.url, headRefName: "f", headRefOid: oid, headRepository: { nameWithOwner: "o/r" }, baseRefName: "main", baseRefOid: base, isDraft: draft }] } } } });
  markPullRequestReady(pr, candidate, run, graphql);
  assert.equal(calls, 1);
});
test("authentication and branch-protection variants fail closed without mistaking an unprotected branch", () => {
  assert.throws(() => authenticateGitHub(() => { throw new Error("not logged in"); }), /authentication failed/);
  const protectedRun: GhRun = args => JSON.stringify(args[1]?.includes("/rules/branches/") ? [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "build", app_id: 9 }] } }] : { contexts: ["legacy"], checks: [{ context: "test", app_id: 7 }] });
  assert.deepEqual(readRequiredContexts(candidate, protectedRun), [{ context: "legacy" }, { context: "test", appId: 7 }, { context: "build", appId: 9 }]);
  const unprotected: GhRun = args => { if (args[1]?.includes("/rules/branches/")) return "[]"; throw new Error("HTTP 404 Branch not protected"); };
  assert.deepEqual(readRequiredContexts(candidate, unprotected), []);
  assert.throws(() => readRequiredContexts(candidate, () => { throw new Error("HTTP 404 Branch not protected"); }), /Effective branch rules could not be verified/);
  assert.throws(() => readRequiredContexts(candidate, () => { throw new Error("HTTP 401"); }), /lookup failed/);
});
test("required contexts stop on ambiguity and preserve app identity", () => {
  const checks = [{ id: "1", name: "test", head: oid, state: "COMPLETED", conclusion: "SUCCESS", appId: 7 }, { id: "2", name: "test", head: oid, state: "COMPLETED", conclusion: "SUCCESS", appId: 8 }];
  assert.equal(mapRequiredContexts([{ context: "test", appId: 7 }], checks)[0]?.id, "1");
  assert.throws(() => mapRequiredContexts([{ context: "test" }], checks), /mapped to 2/);
});

test("exact object evidence revalidates head and bounds body", () => {
  const run: GraphqlRun = args => {
    const query = args.find(arg => arg.startsWith("query=")) ?? "";
    assert.match(query, /IssueComment\{id body url pullRequest\{/);
    assert.doesNotMatch(query, /IssueComment\{[^}]*commit/);
    assert.match(query, /CheckRun\{[^}]*checkSuite\{commit\{oid\}/);
    return JSON.stringify({ data: { node: { __typename: "IssueComment", id: "x", body: "123456", url: "u", pullRequest: { headRefOid: oid } } } });
  };
  assert.deepEqual(fetchExactGitHubObject("x", oid, 3, run), { __typename: "IssueComment", id: "x", body: "123", url: "u", pullRequest: { headRefOid: oid }, truncated: true });
  assert.throws(() => fetchExactGitHubObject("x", base, 3, run), /stale or mismatched/);
});
