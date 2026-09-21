import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { WorkerHub } from "../lib/worker-hub.mjs";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { AgentHubView, createHubViewState, registerWorkerHubUI, compactWorkerLines } = await jiti.import("../worker-hub-ui.ts");
const { WorkerTranscript, safeText, rawTranscript } = await jiti.import("../lib/worker-transcript.ts");
initTheme("dark", false);
const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text };
const keys = { enter: "\r", esc: "\x1b", left: "\x1b[D", down: "\x1b[B", up: "\x1b[A", pageUp: "\x1b[5~", pageDown: "\x1b[6~", altDown: "\x1b[1;3B", altUp: "\x1b[1;3A", f1: "\x1bOP", f2: "\x1bOQ", altA: "\x1ba" };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeSession() {
  const listeners = new Set();
  return { messages: [], isStreaming: true,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(event) { for (const listener of listeners) listener(event); },
    finish(message) { this.messages.push(message); this.emit({ type: "message_end", message }); },
    getContextUsage() { return { tokens: 1000, contextWindow: 10000, percent: 10 }; },
    listenerCount() { return listeners.size; },
  };
}
function message(text, extra = {}) {
  return { role: "assistant", provider: "openai-codex", model: "test", api: "openai-responses", timestamp: Date.now(),
    content: [{ type: "text", text }], stopReason: "stop", usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { total: 0.001 } }, ...extra };
}
function fixture(t) {
  const hub = new WorkerHub(), terminal = { rows: 24, columns: 80 }, tui = { terminal, requestRender() {}, requestComponentRender() {} };
  const state = createHubViewState(hub), views = [];
  const createView = () => { const view = new AgentHubView(tui, theme, hub, "session", () => {}, state); view.focused = true; views.push(view); return view; };
  t.after(() => { for (const view of views) view.dispose(); state.dispose(); hub.dispose(); });
  const add = (id, options = {}) => {
    const session = fakeSession(), calls = [];
    const controls = {
      async send(text, mode, receipt) { calls.push({ text, mode, receipt }); },
      async stop() { calls.push({ stop: true }); session.isStreaming = false; },
      ...options.controls,
    };
    hub.register({ id, label: options.label || `Explorer · ${id}`, role: options.role || "explorer", model: "gpt-5.6-luna", thinking: "medium",
      session, controls, metadata: { parentId: "main", cwd: process.cwd(), task: `Investigate ${id}`, ...options.metadata } });
    return { session, calls, record: hub.get(id) };
  };
  return { hub, state, terminal, tui, add, createView };
}

test("stable identities do not reorder when agents finish or new agents appear", t => {
  const f = fixture(t); f.add("a"); f.add("b"); const view = f.createView();
  view.handleInput(keys.enter); f.hub.unregister("a"); f.add("c");
  assert.equal(f.state.selectedId, "a"); assert.deepEqual(f.hub.list().map(r => r.id), ["a", "b", "c"]);
  assert.match(view.render(80).join("\n"), /Read-only history/);
});

test("native multiline editing keeps Left Arrow, punctuation and bracketed paste in the composer", t => {
  const f = fixture(t); f.add("a"); const view = f.createView(); view.handleInput(keys.enter);
  view.handleInput("abc"); view.handleInput(keys.left); view.handleInput("?");
  assert.equal(f.state.mode, "thread"); assert.equal(f.state.thread("a").editor.getExpandedText(), "ab?c");
  const code = "fn first() {\n    println!(\"中文\");\n}\nfn second() {}";
  f.state.thread("a").editor.setText("");
  view.handleInput("\x1b[200~" + code + "\x1b[201~");
  assert.equal(f.state.thread("a").editor.getExpandedText(), code);
  assert.match(view.render(80).join("\n"), /To: Explorer/);
});

test("thread switch and overlay reopen retain each draft, native cursor and editor instance", t => {
  const f = fixture(t); f.add("a"); f.add("b"); let view = f.createView(); view.handleInput(keys.enter);
  view.handleInput("alpha"); view.handleInput(keys.left);
  const editorA = f.state.thread("a").editor, cursor = editorA.getCursor();
  view.handleInput(keys.altDown); assert.equal(f.state.selectedId, "b"); view.handleInput("beta");
  view.handleInput(keys.altUp); assert.equal(f.state.thread("a").editor, editorA);
  assert.deepEqual(editorA.getCursor(), cursor); assert.equal(editorA.getExpandedText(), "alpha");
  view.dispose(); view = f.createView();
  assert.equal(f.state.thread("a").editor, editorA);
  view.handleInput(keys.altDown); assert.equal(f.state.thread("b").editor.getExpandedText(), "beta");
});

test("a delayed send cannot clear a newer draft or target the newly selected agent", async t => {
  const f = fixture(t), gate = deferred();
  const a = f.add("a", { controls: { send: (text, mode, receipt) => { a.calls.push({ text, mode, receipt }); return gate.promise; } } });
  const b = f.add("b"); const view = f.createView(); view.handleInput(keys.enter);
  view.handleInput("keep the API"); const sending = view.send();
  view.handleInput(keys.altDown); view.handleInput("research codecs");
  view.handleInput(keys.altUp); view.handleInput(" unchanged");
  gate.resolve(); await sending;
  assert.equal(a.calls[0].text, "keep the API"); assert.equal(b.calls.length, 0);
  assert.equal(f.state.thread("a").editor.getExpandedText(), "keep the API unchanged");
  assert.equal(f.state.thread("b").editor.getExpandedText(), "research codecs");
});

test("send failure preserves text and exact recipient even after navigation", async t => {
  const f = fixture(t), gate = deferred(); f.add("a", { controls: { send: () => gate.promise } }); f.add("b");
  const view = f.createView(); view.handleInput(keys.enter); view.handleInput("important correction");
  const send = view.send(); view.handleInput(keys.altDown); gate.reject(new Error("finished before acceptance")); await send;
  assert.equal(f.state.thread("a").editor.getExpandedText(), "important correction");
  assert.equal(f.state.thread("b").editor.getExpandedText(), "");
  assert.match(f.state.thread("a").notice, /Not delivered/);
  assert.equal(f.hub.get("a").receipts[0].workerId, "a");
});

test("completion racing a queued send is visibly undelivered with recoverable text", async t => {
  const f = fixture(t), gate = deferred(); f.add("a", { controls: { send: () => gate.promise } });
  const view = f.createView(); view.handleInput(keys.enter); view.handleInput("check the race");
  const send = view.send(); f.hub.unregister("a"); gate.resolve(); await send;
  assert.equal(f.state.thread("a").editor.getExpandedText(), "check the race");
  assert.equal(f.hub.get("a").receipts[0].state, "undelivered");
});

test("queued and delivered receipts are distinct; observation never implies compliance", async t => {
  const f = fixture(t); const a = f.add("a");
  const receipt = await f.hub.send("a", "look closer", "followUp");
  assert.equal(receipt.state, "queued");
  a.session.emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text: "look closer" }] } });
  assert.equal(receipt.state, "delivered"); assert.ok(receipt.deliveredAt);
  f.hub.unregister("a"); assert.equal(receipt.state, "delivered");
});

test("generic hub forwards the exact instruction; workflow policy is not injected here", async t => {
  const f = fixture(t), a = f.add("a"); await f.hub.steer("a", "What about L4S?");
  assert.equal(a.calls[0].text, "What about L4S?"); assert.ok(!a.calls[0].text.includes("NEEDS_REPLAN"));
});

test("observer failures are isolated and do not change worker state or delivery", async t => {
  const f = fixture(t); f.hub.subscribe(() => { throw new Error("broken renderer"); });
  const a = f.add("a"); await f.hub.send("a", "hello");
  a.session.finish(message("done")); f.hub.unregister("a");
  assert.equal(f.hub.get("a").state, "completed"); assert.equal(a.session.listenerCount(), 0);
  assert.equal(f.hub.lastUIError, "broken renderer");
});

test("partial assistant and partial tool output are visible before final settlement, without final duplication", t => {
  const f = fixture(t), a = f.add("a"); const view = f.createView(); view.handleInput(keys.enter);
  a.session.emit({ type: "message_update", message: message("STREAM_CANARY", { stopReason: undefined }) });
  assert.match(safeText(view.render(80).join("\n")), /STREAM_CANARY/);
  a.session.finish(message("STREAM_CANARY"));
  assert.equal(f.hub.get("a").streaming, null);
  assert.equal((rawTranscript(f.hub.get("a")).match(/STREAM_CANARY/g) || []).length, 1);
  a.session.emit({ type: "tool_execution_start", toolName: "bash", toolCallId: "cmd", args: { command: "cargo test" } });
  a.session.emit({ type: "tool_execution_update", toolName: "bash", toolCallId: "cmd", partialResult: { content: [{ type: "text", text: "PARTIAL_TOOL_CANARY" }] } });
  assert.match(safeText(view.render(80).join("\n")), /PARTIAL_TOOL_CANARY/);
});

test("native tool rendering expands complete multiline errors and raw evidence is never truncated", t => {
  const f = fixture(t), a = f.add("a");
  a.session.finish(message("Inspecting", { content: [{ type: "text", text: "Inspecting" }, { type: "toolCall", id: "cmd", name: "bash", arguments: { command: "cargo test" } }] }));
  const evidence = Array.from({ length: 180 }, (_, i) => `error_${i}: details of a regression`).join("\n") + "\nEND_OF_EVIDENCE_CANARY";
  a.session.finish({ role: "toolResult", toolCallId: "cmd", toolName: "bash", isError: true, content: [{ type: "text", text: evidence }] });
  const transcript = new WorkerTranscript(f.tui, process.cwd()); t.after(() => transcript.dispose());
  const state = { expanded: true, follow: true };
  const render = safeText(transcript.render(a.record, 80, 20, state).join("\n"));
  assert.match(render, /END_OF_EVIDENCE_CANARY/); assert.doesNotMatch(render, /Renderer (failed|unavailable)/);
  assert.ok(rawTranscript(a.record).includes(evidence));
});

test("native edit tools expose the retained diff and do not execute while rendering", t => {
  const f = fixture(t), a = f.add("a");
  a.session.finish(message("", { content: [{ type: "toolCall", id: "edit", name: "edit", arguments: { path: "missing-file.rs", edits: [{ oldText: "old", newText: "NEW_DIFF_CANARY" }] } }] }));
  a.session.finish({ role: "toolResult", toolCallId: "edit", toolName: "edit", isError: false,
    content: [{ type: "text", text: "Updated file" }], details: { diff: "-1 old\n+1 NEW_DIFF_CANARY", patch: "-old\n+NEW_DIFF_CANARY", firstChangedLine: 1 } });
  const transcript = new WorkerTranscript(f.tui, process.cwd()); t.after(() => transcript.dispose());
  const rendered = safeText(transcript.render(a.record, 80, 40, { expanded: true }).join("\n"));
  assert.match(rendered, /NEW_DIFF_CANARY/); assert.doesNotMatch(rendered, /Renderer (failed|unavailable)/);
});

test("history is anchored during new output and PageUp clamps instead of blanking", t => {
  const f = fixture(t), a = f.add("a");
  for (let i = 0; i < 60; i++) a.session.finish(message(`stable passage ${i}`));
  const transcript = new WorkerTranscript(f.tui, process.cwd()); t.after(() => transcript.dispose());
  const state = { raw: true, follow: true }; transcript.render(a.record, 80, 10, state); transcript.scroll(-25, state);
  const before = transcript.render(a.record, 80, 10, state).join("\n");
  a.session.finish(message("new final message"));
  assert.equal(transcript.render(a.record, 80, 10, state).join("\n"), before);
  transcript.scroll(-1000000, state);
  assert.match(transcript.render(a.record, 80, 10, state).join("\n"), /stable passage 0/);
});

test("accounting is lifetime per attempt, missing usage stays unknown and context is separate", t => {
  const f = fixture(t), a = f.add("a"); assert.equal(a.record.stats.totalTokens, null);
  const response = message("done"); a.session.finish(response); a.session.emit({ type: "message_end", message: response });
  assert.equal(a.record.stats.totalTokens, 6); assert.equal(a.record.stats.requests, 1); assert.equal(a.record.context.percent, 10);
  a.session.messages = []; a.session.emit({ type: "session_compact" });
  assert.equal(a.record.stats.totalTokens, 6); assert.equal(a.record.context, null); assert.equal(a.record.messages.length, 1);
});

test("viewport geometry keeps exit/help visible at wide narrow short and Unicode sizes", t => {
  const f = fixture(t); f.add("a", { label: "Explorer · 中文 👩🏽‍💻 " + "long-purpose-".repeat(20) }); const view = f.createView();
  for (const [width, height] of [[160, 45], [120, 32], [80, 24], [40, 12], [30, 7], [19, 5]]) {
    f.terminal.rows = height; f.terminal.columns = width;
    for (const mode of ["roster", "thread", "help"]) {
      f.state.mode = mode;
      const lines = view.render(width);
      assert.ok(lines.length <= height, `${mode}: ${width}x${height}`);
      assert.ok(lines.every(l => visibleWidth(l) <= width), `${mode}: line overflow at ${width}`);
      assert.match(safeText(lines.join("\n")), /Esc|Back/);
      assert.match(safeText(lines.join("\n")), /F1|Help/);
    }
  }
});

test("stop is an explicit safe-default action, Esc or Alt+A only navigates", async t => {
  const f = fixture(t), a = f.add("a"); const view = f.createView(); view.handleInput(keys.enter);
  view.handleInput(keys.f2);
  const menu = view.menu; const stopIndex = menu.findIndex(action => action.label.startsWith("Stop Explorer"));
  assert.ok(stopIndex >= 0); view.menuIndex = stopIndex; view.handleInput(keys.enter); await tick();
  assert.equal(f.state.mode, "confirm"); view.handleInput(keys.enter); await tick();
  assert.equal(a.calls.length, 0, "default Enter must cancel, not stop");
  view.handleInput(keys.altA); assert.equal(a.calls.length, 0);
});

test("human questions never execute a UI callback until explicitly selected", async t => {
  const f = fixture(t), cancellation = new AbortController(); let invoked = 0;
  const pending = f.hub.request({ ownerId: "a", title: "Approve this candidate?", run: async () => { invoked++; return "answer"; } }, cancellation.signal);
  assert.equal(invoked, 0); assert.equal(f.hub.questions().length, 1);
  await f.hub.questions()[0].answer({}); assert.equal(await pending, "answer"); assert.equal(invoked, 1);
  const second = f.hub.request({ title: "another", run: async () => "unexpected" }, cancellation.signal);
  const rejected = assert.rejects(second, /cancel|abort/i); cancellation.abort(); await rejected;
  assert.equal(f.hub.questions().length, 0);
});

test("coalesced rendering withstands many events and repeated overlay lifetimes", async t => {
  const f = fixture(t), a = f.add("a"); let renders = 0; f.tui.requestRender = () => renders++;
  const start = performance.now(); const view = f.createView(); view.handleInput(keys.enter);
  for (let i = 0; i < 3000; i++) a.session.emit({ type: "message_update", message: message(`stream ${i}`) });
  assert.ok(performance.now() - start < 5000, "projection must not block the input loop for seconds");
  await new Promise(resolve => setTimeout(resolve, 60)); assert.ok(renders < 10);
  view.dispose();
  for (let i = 0; i < 30; i++) f.createView().dispose();
  assert.equal(a.session.listenerCount(), 1, "only one authoritative session observer remains");
  assert.equal(f.hub.get("a").streaming.content[0].text, "stream 2999");
});

test("terminal controls in evidence are neutralized but multiline content stays intact", () => {
  assert.equal(safeText("safe\n\x1b[2J\x1b]52;c;c2VjcmV0\x07text\u202e"), "safe\ntext");
});
