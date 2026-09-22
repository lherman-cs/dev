import { test } from "node:test";
import assert from "node:assert/strict";
import { shipBuilderTool, asyncShipBuilderTool, type RunWorker } from "../lib/worker.ts";

const good = { status: "PREPARED", candidate: "head-a", evidence: "proof-a", resultingIdentity: "head-b", summary: "fixed", commits: ["head-b"], localChecks: [{ name: "test", result: "passed" }], repairedFindingKeys: [], risks: [] };
const args = { task: "repair", candidate: "head-a", evidence: "proof-a" };
const ctx = { cwd: process.cwd() } as never;

test("ship Builder binds transport identity and uses a writing child with the ship skill", async () => {
  let request: Record<string, unknown> = {};
  const run = (async (input: Record<string, unknown>) => { request = input; return good; }) as unknown as RunWorker;
  const result = await shipBuilderTool(run).execute("call", args, undefined, undefined, ctx);
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), good);
  assert.equal(request['name'], "build"); assert.equal(request['skill'], "dev-ship-builder");
  assert.equal((request['metadata'] as { phase: string }).phase, "ship");
  const stale = (async () => ({ ...good, evidence: "old" })) as RunWorker;
  await assert.rejects(shipBuilderTool(stale).execute("call", args, undefined, undefined, ctx), /does not match/);
});

test("ship Builder returns receipt before completion and delivers a bounded result", async () => {
  let resolve!: (value: typeof good) => void;
  const run = (() => new Promise(done => { resolve = done as (value: typeof good) => void; })) as unknown as RunWorker;
  const completions: Array<{ status: string; result: string }> = [];
  const tool = asyncShipBuilderTool(run, completion => { completions.push(completion); });
  const receipt = await tool.execute("call", args, undefined, undefined, ctx);
  assert.match((receipt.content[0] as { text: string }).text, /Started asynchronous Builder/);
  assert.equal(completions.length, 0);
  resolve(good);
  await new Promise(done => setImmediate(done));
  assert.equal(completions[0]?.status, "completed");
  assert.deepEqual(JSON.parse(completions[0]!.result), good);
});
