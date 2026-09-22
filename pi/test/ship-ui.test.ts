import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmFinalPacket, renderApprovalPacket, renderWaitProgress } from "../lib/ship-ui.ts";
import type { FinalPacket } from "../lib/ship-contracts.ts";
const oid = "a".repeat(40), candidate = { repository: { root: "/r", coordinate: "github.com/o/r" }, worktree: "/r", branch: { name: "f", head: oid }, base: { ref: "main", oid: "b".repeat(40) }, remote: { name: "origin", url: "https://github.com/o/r.git", oid: "b".repeat(40) } };
const packet: FinalPacket = { candidate, pullRequest: { number: 1, url: "https://github.com/o/r/pull/1", state: "OPEN", draft: true, head: candidate.branch, base: candidate.base }, localChecks: [], ci: { status: "passed", candidate, requiredCheckIds: ["ci"], checks: [] }, inventory: { candidate, items: [{ id: "comment", kind: "comment", head: oid, state: "open", digest: "d".repeat(64) }], digest: "c".repeat(64) }, reviewer: { verdict: "PASS", candidate, inventoryDigest: "c".repeat(64), dispositions: [{ itemId: "comment", disposition: "non_actionable", rationale: "note" }], findings: [], blocker: null }, summary: "Ready", residualRisks: [], repairRounds: 0 };

test("wait progress is compact and identity based", () => {
  assert.equal(renderWaitProgress({ checks: [{ id: "ci", name: "test", head: oid, state: "COMPLETED", conclusion: "SUCCESS" }], observedSignals: ["author:bot"] }, ["ci"], ["author:bot"]), "Waiting: checks 1/1, review signals 1/1");
});
test("approval displays complete packet and cannot be fabricated headlessly or after cancel", async () => {
  const shown: string[] = [];
  const approval = await confirmFinalPacket(packet, { confirm: async (_title, message) => { shown.push(message); return true; } }, "human", 42);
  assert.equal(approval.approvedAt, 42); assert.match(shown[0] ?? "", /Inventory: comment:comment=open/); assert.match(renderApprovalPacket(packet), /Dispositions: comment=non_actionable/);
  await assert.rejects(confirmFinalPacket(packet, undefined, "human"), /Human approval is required/);
  await assert.rejects(confirmFinalPacket(packet, { confirm: async () => false }, "human"), /cancelled/);
});
