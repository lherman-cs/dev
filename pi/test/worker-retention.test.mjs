import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkerHub } from "../lib/worker-hub.mjs";

function fixture(t) {
  const stored = new Map();
  const history = {
    record(record) { if (record.messages.length) stored.set(record.id, [...record.messages]); },
    canLoad(record) { return stored.has(record.id); },
    async load(record) { return [...stored.get(record.id)]; },
  };
  const hub = new WorkerHub({ history }); t.after(() => hub.dispose());
  const add = id => {
    const session = { sessionFile: `/workers/${id}.jsonl`, messages: [{ role: "user", content: `evidence ${id}` }], subscribe: () => () => {} };
    hub.register({ id, label: id, role: "explorer", session }); hub.unregister(id);
    return hub.get(id);
  };
  return { hub, add };
}

test("focused history remains loaded while many newer attempts finish", t => {
  const { hub, add } = fixture(t); const focused = add("focused"); const release = hub.retain(focused.id);
  for (let i = 0; i < 40; i++) add(`new-${i}`);
  assert.equal(focused.loaded, true); assert.equal(focused.messages[0].content, "evidence focused");
  assert.equal(focused.session, undefined, "retaining evidence must not revive an executable agent");
  assert.deepEqual(focused.controls, {}); assert.equal(hub.list().length, 41);
  release(); add("after-release"); assert.equal(focused.loaded, false);
});

test("history retain handles are independently reference-counted and idempotent", t => {
  const { hub, add } = fixture(t); const focused = add("focused");
  const first = hub.retain(focused.id), second = hub.retain(focused.id);
  first(); first();
  for (let i = 0; i < 20; i++) add(`new-${i}`);
  assert.equal(focused.loaded, true, "one live reader still owns the evidence");
  second(); second(); add("released"); assert.equal(focused.loaded, false);
});

test("evicted history reloads without changing the selected identity or granting controls", async t => {
  const { hub, add } = fixture(t); const original = add("original");
  for (let i = 0; i < 20; i++) add(`new-${i}`);
  assert.equal(original.loaded, false); assert.equal(hub.get("original"), original);
  await hub.load("original");
  assert.equal(hub.get("original"), original); assert.equal(original.messages[0].content, "evidence original");
  assert.equal(original.session, undefined); assert.deepEqual(original.controls, {});
});
