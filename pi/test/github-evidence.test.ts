import { test } from "node:test";
import assert from "node:assert/strict";
import { collectGitHubEvidence, digest, listBranchPullRequests, type GraphqlRun } from "../lib/github-evidence.ts";
import type { CandidateIdentity } from "../lib/ship-contracts.ts";

const oid = "a".repeat(40), base = "b".repeat(40);
const candidate: CandidateIdentity = { repository: { root: "/repo", coordinate: "git@github.com:octo/project.git" }, worktree: "/repo", branch: { name: "feature", head: oid }, base: { ref: "main", oid: base }, remote: { name: "origin", url: "git@github.com:octo/project.git", oid: base } };
const page = (nodes: unknown[], next = false) => ({ nodes, pageInfo: { hasNextPage: next, endCursor: next ? "cursor-2" : null } });
test("GraphQL evidence validates the exact PR and paginates audit facts", () => {
  const calls: readonly string[][] = []; let reviewPage = 0;
  const run: GraphqlRun = args => {
    (calls as string[][]).push([...args]); const query = args.find(arg => arg.startsWith("query=")) ?? "";
    if (query.includes("pullRequests")) return JSON.stringify({ data: { repository: { pullRequests: { nodes: [{ number: 7, url: "https://github.com/octo/project/pull/7", state: "OPEN", isDraft: true, headRefName: "feature", headRefOid: oid, headRepository: { nameWithOwner: "octo/project" }, baseRefName: "main", baseRefOid: base }] } } } });
    if (query.includes("reviews(")) { reviewPage++; return JSON.stringify({ data: { repository: { pullRequest: { reviews: page([{ id: `review-${reviewPage}`, state: "APPROVED", commit: { oid } }], reviewPage === 1) } } } }); }
    if (query.includes("pullRequest(number:") && query.includes("comments(") && !query.includes("reviewThreads")) {
      assert.ok(!query.includes("author{login} commit{oid}"), "IssueComment has no commit field");
      return JSON.stringify({ data: { repository: { pullRequest: { comments: page([{ id: "comment" }]) } } } });
    }
    if (query.includes("reviewThreads")) return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: page([{ id: "thread", isResolved: false, isOutdated: false }]) } } } });
    if (query.includes("node(id:")) return JSON.stringify({ data: { node: { comments: page([{ id: "thread-comment", commit: { oid } }]) } } });
    assert.equal([...query].filter(char => char === "{").length, [...query].filter(char => char === "}").length, "check query is balanced");
    assert.ok(!query.includes("CheckRun{id name status conclusion detailsUrl app{databaseId} commit"), "CheckRun has no commit field");
    return JSON.stringify({ data: { repository: { pullRequest: { commits: { nodes: [{
      commit: { oid, statusCheckRollup: { contexts: page([{ __typename: "CheckRun", id: "check", name: "test", status: "COMPLETED", conclusion: "SUCCESS", checkSuite: { commit: { oid } } }]) } },
    }] } } } } });
  };
  const evidence = collectGitHubEvidence(candidate, run);
  assert.equal(evidence.pullRequest.number, 7); assert.equal(evidence.checks[0]?.head, oid); assert.equal(evidence.inventory.items.length, 5);
  assert.ok(calls.some(args => args.includes("cursor=cursor-2")), "review pagination request");
  assert.equal(evidence.inventory.digest, digest(evidence.inventory.items));
});
test("branch PR inventory finds older repository-owned heads but excludes fork PRs", () => {
  const old = "c".repeat(40);
  const run: GraphqlRun = () => JSON.stringify({ data: { repository: { pullRequests: page([
    { number: 4, url: "https://github.com/octo/project/pull/4", isDraft: true, headRefName: "feature", headRefOid: old, headRepository: { nameWithOwner: "octo/project" }, baseRefName: "main", baseRefOid: base },
    { number: 5, url: "https://github.com/octo/project/pull/5", isDraft: true, headRefName: "feature", headRefOid: oid, headRepository: { nameWithOwner: "someone/project" }, baseRefName: "main", baseRefOid: base },
  ]) } } });
  assert.deepEqual(listBranchPullRequests(candidate, run).map(pr => [pr.number, pr.head.head]), [[4, old]]);
});
test("GraphQL evidence refuses a pull request whose immutable identity differs", () => {
  const run: GraphqlRun = () => JSON.stringify({ data: { repository: { pullRequests: { nodes: [{ number: 7, url: "url", isDraft: true, headRefOid: "c".repeat(40), baseRefName: "main", baseRefOid: base }] } } } });
  assert.throws(() => collectGitHubEvidence(candidate, run), /exactly one open pull request/);
});
