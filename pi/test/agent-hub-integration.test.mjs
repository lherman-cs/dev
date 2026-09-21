import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { WorkerHub } from "../lib/worker-hub.mjs";
import { WorkflowControl } from "../lib/workflow-control.mjs";
const jiti = createJiti(import.meta.url);
const { default: extension } = await jiti.import("../extension.ts");
const { AgentHubView, createHubViewState } = await jiti.import("../worker-hub-ui.ts");
const { rawTranscript, WorkerTranscript } = await jiti.import("../lib/worker-transcript.ts");
initTheme("dark", false);
const theme = { fg: (_c, s) => s, bg: (_c, s) => s, bold: s => s };
const tick = () => new Promise(resolve => setImmediate(resolve));

function contextApi() {
  const commands = new Map(), events = new Map(), producers = new Map(), widgets = new Map();
  const pi = {
    registerCommand: (name, command) => commands.set(name, command), registerShortcut() {}, registerTool() {},
    on: (name, handler) => events.set(name, handler),
    events: { on(name, handler) { producers.set(name, handler); return () => producers.delete(name); } },
    sendUserMessage() {}, sendMessage() {}, exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  };
  const ctx = { hasUI: true, cwd: process.cwd(), ui: { notify() {}, setWidget: (name, widget) => widgets.set(name, widget),
    custom: async factory => { const view = factory({ terminal: { rows: 24, columns: 80 }, requestRender() {} }, theme, {}, () => {}); view.dispose(); } } };
  return { pi, ctx, commands, events, producers, widgets };
}

test("producer seam registers an independent Main child even without a reply callback", async t => {
  const f = contextApi(); extension(f.pi); f.events.get("session_start")({}, f.ctx);
  t.after(() => f.events.get("session_shutdown")());
  f.producers.get("dev:agent-hub")({ action: "register", worker: { id: "external", role: "custom", label: "Independent investigation", state: "working", controls: {} } });
  await new Promise(resolve => setTimeout(resolve, 50));
  const widget = f.widgets.get("dev-workers");
  assert.equal(typeof widget, "function");
  assert.match(widget().render(80).join("\n"), /Independent investigation/);
  assert.ok(widget().render(24).every(line => visibleWidth(line) <= 24));
  f.producers.get("dev:agent-hub")({ action: "finish", id: "external", state: "completed" });
});

test("headless human requests fail rather than hanging or treating absence as approval", async () => {
  const hub = new WorkerHub(); hub.interactive = false;
  let invoked = false;
  await assert.rejects(hub.request({ title: "Approve?", run: async () => { invoked = true; } }), /requires interactive Pi/);
  assert.equal(invoked, false); assert.deepEqual(hub.questions(), []); hub.dispose();
});

test("pause requested during project discovery does not grant unverified manual write ownership", async () => {
  const control = new WorkflowControl(); control.pause();
  await control.checkpoint("Resolving project");
  assert.equal(control.paused, false);
  control.snapshot = async () => "known worktree";
  const waiting = control.checkpoint("Before first write"); await tick();
  assert.equal(control.paused, true); await control.resume(); await waiting;
});

test("continuing a writing workflow waits for Main to finish and keeps the pause on rejection", async () => {
  let idle = false;
  const control = new WorkflowControl({ snapshot: async () => "stable", canResume: () => idle }); control.pause();
  const waiting = control.checkpoint(); await tick();
  await assert.rejects(control.resume(), /Main's current turn/);
  assert.equal(control.paused, true); assert.equal(control.signal.aborted, false);
  idle = true; await control.resume(); await waiting;
});

test("stop during an operation cannot turn a later successful exit into accepted work", async () => {
  const control = new WorkflowControl();
  await assert.rejects(control.operation("check", [], async () => { control.stop(); return { code: 0 }; }), /stopped/);
  assert.equal(control.operations[0].state, "cancelled");
});

test("a focused transcript stays cached while other workers finish and all identities survive", () => {
  const history = { record() {}, canLoad: () => true }, hub = new WorkerHub({ history });
  for (let i = 0; i < 20; i++) {
    hub.register({ id: String(i), role: "explorer", session: { sessionFile: `file${i}`, messages: [], subscribe: () => () => {} } });
    if (i === 0) hub.retain("0");
    hub.unregister(String(i));
  }
  assert.equal(hub.get("0").loaded, true); assert.equal(hub.get("1").loaded, false); assert.equal(hub.list().length, 20);
  hub.dispose();
});

test("native raw and copied evidence include current tool output before the tool returns", t => {
  const record = { messages: [], streaming: null, revision: 1, liveTools: new Map([["tool", { toolName: "bash", result: { content: [{ type: "text", text: "PARTIAL_RAW_CANARY" }] } }]]) };
  assert.match(rawTranscript(record), /PARTIAL_RAW_CANARY/);
  const transcript = new WorkerTranscript({ requestRender() {} }, process.cwd()); t.after(() => transcript.dispose());
  assert.match(transcript.render(record, 80, 10, { raw: true }).join("\n"), /PARTIAL_RAW_CANARY/);
});

test("starting a new read-only follow-up selects its separate thread without reviving its predecessor", async t => {
  const hub = new WorkerHub(); hub.register({ id: "old", role: "build", label: "Accepted Builder", metadata: { producer: "dev-workflow" } }); hub.unregister("old");
  hub.readOnlyFollowUp = async () => { hub.register({ id: "new", label: "Follow-up", role: "explorer", state: "working", controls: {} }); return { id: "new" }; };
  const state = createHubViewState(hub), view = new AgentHubView({ terminal: { rows: 24, columns: 80 }, requestRender() {} }, theme, hub, "session", () => {}, state);
  t.after(() => { view.dispose(); state.dispose(); hub.dispose(); });
  state.mode = "thread"; const thread = state.thread("old"); thread.newFollowUp = true; thread.editor.setText("Why this approach?");
  await view.send(); assert.equal(state.selectedId, "new"); assert.equal(hub.get("old").state, "completed"); assert.equal(hub.get("old").session, undefined);
  assert.equal(thread.editor.getExpandedText(), "");
});

test("closing a parent runtime prevents delayed draft callbacks from writing its old history", () => {
  let writes = 0; const hub = new WorkerHub({ history: { saveDraft() { writes++; } } });
  const state = createHubViewState(hub); state.tui = { terminal: { rows: 24 }, requestRender() {} }; state.theme = theme;
  const thread = state.thread("a"); thread.editor.setText("saved"); state.dispose(); const before = writes;
  thread.editor.setText("late result"); state.flush(); assert.equal(writes, before); hub.dispose();
});
