import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelRuntime, createAgentSession } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createWorkerRunner } from "../lib/worker.mjs";
import { WorkerHub } from "../lib/worker-hub.mjs";
import { WorkerHistory } from "../lib/worker-history.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function response(model, text = "done", content, stopReason = "stop") {
  return { role: "assistant", content: content || [{ type: "text", text }], provider: model.provider, model: model.id, api: model.api,
    stopReason, timestamp: Date.now(), usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
async function fixture(t, handler, { history = false, createHook } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-interaction-"));
  const cwd = path.join(root, "worktree"), agentDir = path.join(root, "agent"); fs.mkdirSync(cwd); fs.mkdirSync(agentDir);
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = agentDir;
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "Keep the repository's behavior stable.\n");
  const runtime = await ModelRuntime.create(); runtime.hasConfiguredAuth = () => true;
  const calls = [], sessions = [], options = [];
  const hub = new WorkerHub({ history: history ? new WorkerHistory({ cwd, sessionId: "test-parent", sessionDir: path.join(root, "sessions") }) : undefined });
  t.after(async () => {
    await hub.stopAll(); hub.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  runtime.streamSimple = (model, context, requestOptions) => {
    const stream = createAssistantMessageEventStream();
    let completed = false;
    const abort = () => {
      if (completed) return; completed = true;
      stream.push({ type: "error", reason: "aborted", error: { ...response(model, "", [], "aborted"), errorMessage: "simulated provider cancelled" } });
    };
    const finish = message => {
      if (completed) return; completed = true;
      requestOptions.signal?.removeEventListener("abort", abort);
      stream.push({ type: "done", reason: message.stopReason, message });
    };
    requestOptions.signal?.addEventListener("abort", abort, { once: true });
    if (requestOptions.signal?.aborted) { abort(); return stream; }
    const call = { model, context, options: requestOptions, stream }; calls.push(call);
    if (calls.length > 15) {
      finish(response(model, `Unexpected model loop: ${JSON.stringify(context.messages.at(-1))}`)); return stream;
    }
    const answer = handler({ ...call, n: calls.length, hub, finish });
    if (answer) queueMicrotask(() => finish(answer));
    return stream;
  };
  const run = createWorkerRunner({ runtime, hub, create: async input => {
    options.push(input); const result = await createAgentSession(input); sessions.push(result.session);
    await createHook?.(result.session); return result;
  } });
  return { root, cwd, runtime, hub, run, calls, sessions, options };
}
const schema = { type: "object", additionalProperties: false, required: ["verdict"], properties: { verdict: { enum: ["pass", "blocked"] } } };
let resultId = 0;
const verdict = (model, value = "pass") => response(model, "", [{ type: "toolCall", id: `result-${++resultId}`, name: "submit_result", arguments: { verdict: value } }], "toolUse");

test("actual SDK: Main Explorer receives ordinary steering, records delivery and retains native history", { timeout: 15000 }, async t => {
  const ready = deferred();
  const f = await fixture(t, call => {
    if (call.n === 1) { ready.resolve(call); return; }
    assert.match(JSON.stringify(call.context.messages), /What about L4S/);
    return response(call.model, "follow-up addressed");
  }, { history: true });
  const pending = f.run({ cwd: f.cwd, name: "explorer", task: "Explore congestion signals" });
  const first = await ready.promise;
  const id = f.hub.list()[0].id;
  const receipt = await f.hub.send(id, "What about L4S?");
  assert.equal(receipt.state, "queued"); assert.equal(receipt.wireText, "What about L4S?");
  first.finish(response(first.model, "first response"));
  assert.equal(await pending, "follow-up addressed"); assert.equal(receipt.state, "delivered");
  assert.equal(f.hub.get(id).state, "completed"); assert.ok(fs.existsSync(f.hub.get(id).sessionFile));
  const saved = f.hub.history.records().find(r => r.id === id);
  assert.equal(saved.receipts[0].state, "delivered");
  assert.ok((await f.hub.history.load(saved)).some(m => m.role === "user" && JSON.stringify(m.content).includes("What about L4S?")));
});

test("actual SDK: clearing a native queue retains receipt text and does not cause another model call", { timeout: 15000 }, async t => {
  const ready = deferred(); const f = await fixture(t, call => { ready.resolve(call); });
  const pending = f.run({ cwd: f.cwd, name: "explorer", task: "Find one answer" });
  const first = await ready.promise, record = f.hub.list()[0];
  const receipt = await f.hub.send(record.id, "wrong direction");
  assert.equal(record.controls.cancelQueued(), 1); assert.equal(receipt.state, "cancelled");
  first.finish(response(first.model)); await pending;
  assert.equal(f.calls.length, 1); assert.equal(receipt.text, "wrong direction");
});

test("actual SDK: a pre-intervention structured result is rejected at settlement", { timeout: 15000 }, async t => {
  const ready = deferred();
  const f = await fixture(t, call => {
    if (call.n === 1) return verdict(call.model);
    if (call.n === 2) { ready.resolve(call); return; }
    return response(call.model, "I reconsidered but did not submit a new verdict");
  });
  const pending = f.run({ cwd: f.cwd, name: "review", task: "Review exact candidate", schema, skill: "dev-review" });
  const rejected = assert.rejects(pending, /no current structured result/);
  const held = await ready.promise; await f.hub.send(f.hub.list()[0].id, "Recheck compatibility");
  held.finish(response(held.model, "old wrap-up")); await rejected; assert.equal(f.hub.list()[0].state, "failed");
});

test("actual SDK: a current blocked result after human review feedback is accepted", { timeout: 15000 }, async t => {
  const ready = deferred();
  const f = await fixture(t, call => {
    if (call.n === 1) return verdict(call.model);
    if (call.n === 2) { ready.resolve(call); return; }
    if (call.n === 3) return verdict(call.model, "blocked");
    return response(call.model, "Revised verdict submitted");
  });
  const pending = f.run({ cwd: f.cwd, name: "review", task: "Review exact candidate", schema, rejectPassOnFeedback: true });
  const held = await ready.promise; await f.hub.send(f.hub.list()[0].id, "This acceptance criterion is wrong");
  held.finish(response(held.model)); assert.deepEqual(await pending, { verdict: "blocked" });
});

test("actual SDK: silently repeating PASS after delivered review feedback is rejected", { timeout: 15000 }, async t => {
  const ready = deferred();
  const f = await fixture(t, call => {
    if (call.n === 1 || call.n === 3) return verdict(call.model);
    if (call.n === 2) { ready.resolve(call); return; }
    return response(call.model, "pass");
  });
  const pending = f.run({ cwd: f.cwd, name: "review", task: "Review exact candidate", schema, rejectPassOnFeedback: true });
  const rejected = assert.rejects(pending, /not silent PASS/);
  const held = await ready.promise; await f.hub.send(f.hub.list()[0].id, "There is an unaddressed failure");
  held.finish(response(held.model)); await rejected;
});

test("lifetime cancellation during registration prevents session creation and first provider call", { timeout: 15000 }, async t => {
  const f = await fixture(t, () => assert.fail("no model call after startup stop")); let stopped = false;
  f.hub.subscribe(records => { const r = records.find(r => r.state === "starting"); if (r && !stopped) { stopped = true; void f.hub.abort(r.id); } });
  await assert.rejects(f.run({ cwd: f.cwd, name: "build", task: "Do not start" }), /stopped/);
  assert.equal(f.calls.length, 0); assert.equal(f.sessions.length, 0); assert.equal(f.hub.list()[0].state, "aborted");
});

test("lifetime cancellation while extensions bind cannot start a prompt afterward", { timeout: 15000 }, async t => {
  const ready = deferred(), release = deferred();
  const f = await fixture(t, () => assert.fail("no provider after cancellation"), { createHook: async session => {
    const bind = session.bindExtensions.bind(session);
    session.bindExtensions = async (...args) => { await bind(...args); ready.resolve(); await release.promise; };
  } });
  const pending = f.run({ cwd: f.cwd, name: "build", task: "Wait for binding" }); const rejected = assert.rejects(pending, /stopped/);
  await ready.promise; await f.hub.abort(f.hub.list()[0].id); release.resolve(); await rejected;
  assert.equal(f.calls.length, 0); assert.equal(f.hub.list()[0].session, undefined);
});

test("stopping a Builder cancels its active nested Explorer and preserves lineage", { timeout: 15000 }, async t => {
  const nested = deferred(); let parentTurns = 0;
  const f = await fixture(t, call => {
    if (call.model.id.includes("sol")) return ++parentTurns === 1
      ? response(call.model, "", [{ type: "toolCall", id: "investigation", name: "explore", arguments: { task: "Inspect the tests" } }], "toolUse")
      : response(call.model, `Unexpected continuation: ${JSON.stringify(call.context.messages.at(-1))}`);
    nested.resolve();
  });
  const pending = f.run({ cwd: f.cwd, name: "build", task: "PRIVATE_PARENT_TEXT", skill: "dev-implement" });
  const settled = pending.then(value => ({ value }), error => ({ error }));
  const reached = await Promise.race([nested.promise.then(() => true), settled]);
  assert.equal(reached, true, `Nested worker did not start: ${JSON.stringify(reached)}`);
  const parent = f.hub.list().find(r => r.role === "build"), child = f.hub.list().find(r => r.role === "explorer");
  assert.equal(child.metadata.parentId, parent.id); assert.ok(!JSON.stringify(f.calls[1].context.messages).includes("PRIVATE_PARENT_TEXT"));
  await f.hub.abort(parent.id); const result = await settled;
  assert.ok(result.error, "cancelled parent must not produce an accepted result");
  assert.ok(f.hub.list().every(r => r.state === "aborted" && !r.session));
});

test("a native worker waits for explicit human input; inspection alone cannot answer", { timeout: 15000 }, async t => {
  const asked = deferred();
  const f = await fixture(t, call => call.n === 1
    ? response(call.model, "", [{ type: "toolCall", id: "human", name: "ask_human", arguments: { question: "Which invariant?", choices: ["A", "B"] } }], "toolUse")
    : response(call.model, "Human input handled"));
  f.hub.subscribe(() => { if (f.hub.questions().length) asked.resolve(); });
  const pending = f.run({ cwd: f.cwd, name: "explorer", task: "Ask one question" });
  const settled = pending.then(value => ({ value }), error => ({ error }));
  const ready = await Promise.race([asked.promise.then(() => true), settled]); assert.equal(ready, true, JSON.stringify(ready));
  assert.equal(f.calls.length, 1); let showed = false;
  await f.hub.questions()[0].answer({ hasUI: true, ui: { select: async () => { showed = true; return "B"; } } });
  assert.equal(await pending, "Human input handled"); assert.equal(showed, true); assert.equal(f.hub.questions().length, 0);
});

test("VCC loads in the child and its native registered tools are not hidden by the whitelist", { timeout: 15000 }, async t => {
  const f = await fixture(t, call => response(call.model)); await f.run({ cwd: f.cwd, name: "explorer", task: "One answer" });
  const vcc = f.options[0].resourceLoader.getExtensions().extensions.find(e => e.resolvedPath.includes("pi-vcc"));
  assert.ok(vcc, "VCC must be explicitly loaded, not inferred from Main");
  const tools = [...vcc.tools.keys()]; assert.ok(tools.length > 0, "pinned VCC should expose its recall tool");
  for (const name of tools) assert.ok(f.sessions[0].getActiveToolNames().includes(name), `missing VCC capability: ${name}`);
});

test("completed Builder follow-up starts a fresh read-only child and never changes the accepted result", { timeout: 15000 }, async t => {
  const f = await fixture(t, call => response(call.model, "original result"));
  await f.run({ cwd: f.cwd, name: "build", task: "Implement one contract" });
  const original = f.hub.list()[0]; const snapshot = JSON.stringify(original.messages);
  const follow = await f.hub.readOnlyFollowUp(original, "Explain your choice");
  assert.ok(follow.id && follow.id !== original.id); await follow.completion;
  const child = f.hub.get(follow.id); assert.equal(child.metadata.parentId, original.id);
  assert.equal(child.role, "explorer"); assert.equal(JSON.stringify(original.messages), snapshot);
  assert.ok(!f.sessions[1].getActiveToolNames().some(name => ["write", "edit", "bash"].includes(name)));
});
