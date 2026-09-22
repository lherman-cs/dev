import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ShipStore, validateBuildHandoff } from "../lib/ship-store.ts";

const oid = "a".repeat(40);
const candidate = { repository: { root: "/repo/.git", coordinate: "origin" }, worktree: "/repo", branch: { name: "feature", head: oid }, base: { ref: "main", oid }, remote: { name: "origin", url: "origin" } };
const v1 = { version: 1, candidate, approved: { spec: { path: "s", sha256: "b".repeat(64) }, plan: { path: "p", sha256: "c".repeat(64) } }, completedOutcomes: ["done"], localChecks: [], residualRisks: [], unresolvedDecisions: [], recordedAt: 1 };

test("ship store migrates v1 handoffs and rejects invalid persisted state", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ship-store-")); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ShipStore(directory); fs.writeFileSync(store.handoffPath, JSON.stringify(v1));
  const handoff = store.loadHandoff(); assert.equal(handoff.version, 2); assert.deepEqual(handoff.expectedReviewSignals, []);
  fs.writeFileSync(store.statePath, "{}\n"); assert.throws(() => store.load(), /schema is invalid/);
});

test("ship store writes atomically and journals intent before receipt", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ship-store-")); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ShipStore(directory), handoff = validateBuildHandoff(v1);
  const state = { invocationId: "inv", revision: 0, phase: "handoff" as const, candidate, handoff, repairs: 0, stableKeys: [] };
  store.save({ version: 2, state, operations: [] });
  const receipt = { id: "op", invocationId: "inv", action: "publish", candidateHead: oid, desiredDigest: "d", status: "receipt" as const, recordedAt: 2 };
  assert.throws(() => store.append(receipt), /no matching intent/);
  store.append({ ...receipt, status: "intent", recordedAt: 1 }); store.append(receipt);
  assert.equal(store.load()?.operations.length, 2); assert.deepEqual(fs.readdirSync(directory).filter(file => file.endsWith(".tmp")), []);
});
