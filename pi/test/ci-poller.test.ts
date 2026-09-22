import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForCi, type Clock } from "../lib/ci-poller.ts";
import type { CandidateIdentity, CiCheck, WaitOutcome } from "../lib/ship-contracts.ts";
const oid = "a".repeat(40), candidate: CandidateIdentity = { repository: { root: "/r", coordinate: "github.com/o/r" }, worktree: "/r", branch: { name: "f", head: oid }, base: { ref: "main", oid: "b".repeat(40) }, remote: { name: "origin", url: "https://github.com/o/r.git", oid: "b".repeat(40) } };
const check = (state: string, conclusion: string | null = null, head = oid): CiCheck => ({ id: "required", name: "test", state, conclusion, head });
function fakeClock(): [Clock, () => void] { let now = 0; return [{ now: () => now, sleep: async ms => { now += ms; } }, () => { now += 100; }]; }
function deps(observations: CiCheck[][]) { const observationsSaved: CiCheck[][] = [], results: WaitOutcome[] = []; const [clock] = fakeClock(); return { observationsSaved, results, clock, observe: async () => observations.shift() ?? [], persistObservation: (_: CandidateIdentity, checks: CiCheck[]) => { observationsSaved.push(checks); }, persist: (result: WaitOutcome) => { results.push(result); } }; }
test("CI poller persists observations and reaches passed or failed only for exact required checks", async () => {
  const d = deps([[check("IN_PROGRESS")], [check("COMPLETED", "SUCCESS")]]); const result = await waitForCi(candidate, ["required"], d, { initialDelayMs: 1, maxDelayMs: 4, timeoutMs: 10 });
  assert.equal(result.status, "passed"); assert.deepEqual(result.requiredCheckIds, ["required"]); assert.equal(d.observationsSaved.length, 2); assert.equal(d.results.length, 1);
  const failed = deps([[check("COMPLETED", "FAILURE")]]); assert.equal((await waitForCi(candidate, ["required"], failed, { initialDelayMs: 1, maxDelayMs: 2, timeoutMs: 10 })).status, "failed");
});
test("CI poller waits for configured review signals and persists combined observations", async () => {
  const d = deps([[check("COMPLETED", "SUCCESS")], [check("COMPLETED", "SUCCESS")]]), signalPages = [[], ["author:bot"]];
  const result = await waitForCi(candidate, ["required"], { ...d, observeSignals: async () => signalPages.shift() ?? [] }, { initialDelayMs: 1, maxDelayMs: 2, timeoutMs: 10 }, undefined, ["author:bot"]);
  assert.equal(result.status, "passed"); assert.deepEqual(result.observedSignals, ["author:bot"]); assert.equal(d.observationsSaved.length, 2);
});
test("CI poller is cancellable and refuses missing, stale, or indefinitely pending evidence", async () => {
  const controller = new AbortController(); controller.abort(); const cancelled = deps([]); assert.equal((await waitForCi(candidate, ["required"], cancelled, { initialDelayMs: 1, maxDelayMs: 2, timeoutMs: 10 }, controller.signal)).status, "cancelled");
  const stale = deps([[check("COMPLETED", "SUCCESS", "c".repeat(40))]]); assert.equal((await waitForCi(candidate, ["required"], stale, { initialDelayMs: 1, maxDelayMs: 2, timeoutMs: 10 })).status, "interrupted");
  const timeout = deps([[check("IN_PROGRESS")], [check("IN_PROGRESS")], [check("IN_PROGRESS")], [check("IN_PROGRESS")]]); assert.equal((await waitForCi(candidate, ["required"], timeout, { initialDelayMs: 2, maxDelayMs: 4, timeoutMs: 3 })).status, "stale_timeout");
});
