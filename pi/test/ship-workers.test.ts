import { test } from "node:test";
import assert from "node:assert/strict";
import { runShipBuilder, runShipReviewer } from "../lib/ship-workers.ts";
import type { RunWorker } from "../lib/worker.ts";
import type { BuildHandoff, Inventory, PullRequestIdentity, ReviewerResult, WaitOutcome } from "../lib/ship-contracts.ts";
const oid = "a".repeat(40), base = "b".repeat(40), candidate = { repository: { root: "/r", coordinate: "github.com/o/r" }, worktree: "/r", branch: { name: "f", head: oid }, base: { ref: "main", oid: base }, remote: { name: "origin", url: "https://github.com/o/r.git", oid: base } };
const handoff = { version: 2, candidate, approved: { spec: { path: "spec", sha256: "c".repeat(64) }, plan: { path: "plan", sha256: "d".repeat(64) } }, completedOutcomes: ["done"], localChecks: [], residualRisks: [], unresolvedDecisions: [], expectedReviewSignals: [], recordedAt: 1 } as BuildHandoff;
const pullRequest: PullRequestIdentity = { number: 1, url: "u", state: "OPEN", draft: true, head: candidate.branch, base: candidate.base };
const failedCi: WaitOutcome = { status: "failed", candidate, requiredCheckIds: ["ci"], checks: [{ id: "ci", name: "CI", head: oid, state: "COMPLETED", conclusion: "FAILURE" }] };
const reviewer: ReviewerResult = { verdict: "REPAIRS", candidate, inventoryDigest: "e".repeat(64), dispositions: [], findings: [{ key: "k", evidence: ["e"], acceptanceChecks: ["a"] }], blocker: null };
const inventory: Inventory = { candidate, items: [], digest: "e".repeat(64) };

test("ship worker adapters deliver canonical payloads and route Terra then Sol without human tools", async () => {
  const calls: any[] = []; const run = (async args => { calls.push(args); return args.name === "review" ? { ...reviewer, verdict: "PASS", findings: [] } : { candidate, localChecks: [], repairedKeys: ["k"], blocker: null }; }) as RunWorker;
  const payload = { handoff, candidate, pullRequest, failedCi, reviewer, round: 1 as const };
  await runShipBuilder(run, payload); await runShipBuilder(run, { ...payload, round: 2 }); await runShipReviewer(run, { handoff, candidate, pullRequest, inventory });
  assert.deepEqual(calls.map(call => call.name), ["build", "escalated_builder", "review"]);
  assert.equal(calls[0].skill, "dev-ship-builder"); assert.equal(calls[0].task, calls[0].task.split("").join(""));
  assert.match(calls[0].task, /"failedCi"/); assert.match(calls[0].task, /"reviewer"/);
  assert.equal(calls[2].scopedTools[0].name, "ship_candidate_evidence"); assert.equal(calls[2].tools, undefined);
});
