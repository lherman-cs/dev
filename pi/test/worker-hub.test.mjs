import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkerHub } from "../lib/worker-hub.mjs";
import { createJiti } from "jiti";
const { AgentHubView, compactWorkerLines, workerLines } = await createJiti(import.meta.url).import("../worker-hub-ui.ts");

function session() {
  const listeners = new Set(), calls = [];
  return {
    messages: [], calls,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(event) { for (const fn of listeners) fn(event); },
    async steer(text) { calls.push(["steer", text]); },
    async followUp(text) { calls.push(["followUp", text]); },
    async abort() { calls.push(["abort"]); },
    listenerCount() { return listeners.size; },
  };
}
function register(hub, s, id = "build:1", label = "build:P001") {
  hub.register({ id, label, role: "build", model: "gpt-5.6-sol", thinking: "low", session: s, metadata: { phase: "build", task: "Implement parser" } });
}
const theme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: text => text,
};

test("register, live update, telemetry, completion snapshot and cleanup", () => {
  const hub = new WorkerHub(), s = session(), states = [];
  hub.subscribe(records => states.push(records.map(r => r.state)));
  register(hub, s);
  s.messages.push({
    role: "assistant",
    content: [{ type: "text", text: "implementing" }, { type: "toolCall", name: "edit", arguments: { path: "src/foo.rs" } }],
    usage: { input: 4, output: 2, totalTokens: 6, cost: { total: 0.001 } },
  });
  s.emit({ type: "tool_execution_start", toolName: "edit", args: { path: "src/foo.rs" } });
  assert.match(compactWorkerLines(hub.list(), "Agents").join("\n"), /build:P001.*edit src\/foo.rs/);
  assert.match(workerLines(hub.get("build:1")).join("\n"), /assistant  implementing/);
  assert.equal(hub.get("build:1").stats.totalTokens, 6);
  assert.equal(hub.get("build:1").stats.tools, 1);
  assert.equal(hub.get("build:1").stats.requests, 1);
  hub.unregister("build:1", "completed");
  assert.equal(hub.get("build:1").session, undefined);
  assert.equal(hub.get("build:1").state, "completed");
  assert.equal(s.listenerCount(), 0);
  hub.dispose();
  assert.deepEqual(hub.list(), []);
  assert.ok(states.length >= 3);
});

test("steering, follow-up and abort only interact with the supplied running session", async () => {
  const hub = new WorkerHub(), s = session();
  register(hub, s);
  await hub.steer("build:1", "use the existing parser");
  await hub.followUp("build:1", "also check the regression");
  await hub.abort("build:1");
  assert.deepEqual(s.calls.map(call => call[0]), ["steer", "followUp", "abort"]);
  assert.match(s.calls[0][1], /current approved contract/);
  assert.match(s.calls[0][1], /NEEDS_REPLAN/);
  assert.equal(hub.get("build:1").state, "aborting");
  assert.deepEqual(hub.get("build:1").metadata, { phase: "build", task: "Implement parser" }, "UI must not acquire orchestration state");
});

test("hub is self-teaching and drills from roster into the selected live thread", () => {
  const hub = new WorkerHub(), s1 = session(), s2 = session();
  register(hub, s1, "explorer:1", "explorer:1");
  hub.register({ id: "explorer:2", label: "explorer:2", role: "explorer", model: "gpt-5.6-luna", thinking: "medium", session: s2, metadata: { task: "Inspect tests" } });
  s1.messages.push({ role: "assistant", content: [{ type: "text", text: "Found parser entry point" }] });
  let renders = 0, closed = 0;
  const view = new AgentHubView({ requestRender() { renders++; } }, theme, hub, "session", () => { closed++; });
  const roster = view.render(120).join("\n");
  assert.match(roster, /Agent Hub/);
  assert.match(roster, /explorer:1/);
  assert.match(roster, /↑↓\/jk navigate.*Enter inspect.*Esc\/Alt\+A close/);
  view.handleInput("\r");
  const thread = view.render(120).join("\n");
  assert.match(thread, /Found parser entry point/);
  assert.match(thread, /type \+ Enter steer.*Ctrl\+Enter follow-up.*Esc agents/);
  view.handleInput("\u001b");
  assert.match(view.render(120).join("\n"), /CHILD AGENTS/);
  assert.equal(closed, 0);
  view.handleInput("\u001b");
  assert.equal(closed, 1);
  assert.ok(renders >= 2);
  view.dispose();
});

test("Alt+A closes the hub from either view without affecting the worker", () => {
  const hub = new WorkerHub(), s = session();
  register(hub, s);
  let closed = 0;
  const view = new AgentHubView({ requestRender() {} }, theme, hub, "session", () => { closed++; });
  view.handleInput("\x1ba");
  assert.equal(closed, 1);
  assert.deepEqual(s.calls, []);
  view.dispose();
});
