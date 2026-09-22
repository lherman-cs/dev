import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { reconcileShipTodos } from "../lib/ship-todo.ts";
import type { ShipState } from "../lib/ship-runtime.ts";

const jiti = createJiti(import.meta.url);
const store = await jiti.import("@juicesharp/rpiv-todo/state/store.ts") as { replaceState(id: string, state: unknown): void };
const oid = "a".repeat(40), candidate = { repository: { root: "/r/.git", coordinate: "origin" }, worktree: "/r", branch: { name: "f", head: oid }, base: { ref: "main", oid: "b".repeat(40) }, remote: { name: "origin", url: "origin" } };
const handoff = { version: 2 as const, candidate, approved: { spec: { path: "s", sha256: "c".repeat(64) }, plan: { path: "p", sha256: "d".repeat(64) } }, completedOutcomes: ["one"], localChecks: [], residualRisks: [], unresolvedDecisions: [], expectedReviewSignals: [], recordedAt: 1 };
const state = (head = oid, phase: ShipState["phase"] = "handoff", repairs = 0): ShipState => ({ invocationId: "inv", revision: 0, phase, candidate: { ...candidate, branch: { ...candidate.branch, head } }, handoff, repairs, stableKeys: [] });

test("ship todo projection preserves user tasks and derives truthful progress", () => {
  store.replaceState("s", { tasks: [{ id: 1, subject: "User task", status: "pending" }], nextId: 2 });
  const tasks = reconcileShipTodos("s", state(oid, "prepared"));
  assert.equal(tasks.find(task => task.id === 1)?.subject, "User task");
  const ship = tasks.filter(task => task.metadata?.["shipInvocation"] === "inv");
  assert.equal(ship.length, 9); assert.equal(ship.filter(task => task.status === "completed").length, 5); assert.equal(ship.filter(task => task.status === "in_progress").length, 1);
});

test("candidate invalidation tombstones stale generation and appends a fresh one", () => {
  store.replaceState("g", { tasks: [], nextId: 1 });
  reconcileShipTodos("g", state());
  const tasks = reconcileShipTodos("g", state("e".repeat(40), "handoff", 1));
  assert.equal(tasks.filter(task => task.status === "deleted").length, 9);
  assert.equal(tasks.filter(task => task.metadata?.["shipGeneration"] === `1:${"e".repeat(40)}` && task.status !== "deleted").length, 9);
});
