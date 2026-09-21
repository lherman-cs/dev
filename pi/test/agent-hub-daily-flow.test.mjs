import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { WorkerHub } from "../lib/worker-hub.mjs";
const { AgentHubView, createHubViewState } = await createJiti(import.meta.url).import("../worker-hub-ui.ts");
const { WorkerTranscript } = await createJiti(import.meta.url).import("../lib/worker-transcript.ts");
initTheme("dark", false);
const theme = { fg: (_, s) => s, bg: (_, s) => s, bold: s => s };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture(t) {
  const hub = new WorkerHub(), sessions = [];
  for (let i = 0; i < 2; i++) {
    const listeners = new Set();
    const session = { messages: [], calls: [], subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      emit(e) { for (const fn of listeners) fn(e); }, async steer(text) { this.calls.push(["steer", text]); },
      async followUp(text) { this.calls.push(["followUp", text]); }, async abort() { this.calls.push(["abort"]); } };
    sessions.push(session);
    hub.register({ id: `w${i}`, label: `Worker ${i}`, role: "explorer", model: "luna", thinking: "medium", session,
      metadata: { parentId: "main", cwd: process.cwd(), task: `Investigate ${i}` },
      controls: { send: (text, mode) => session[mode](text), stop: () => session.abort() } });
  }
  const tui = { terminal: { rows: 24, columns: 80 }, requestRender() {} }, state = createHubViewState(hub);
  let closed = 0;
  const view = new AgentHubView(tui, theme, hub, "session", () => { closed++; }, state); view.focused = true; view.render(80);
  t.after(() => { view.dispose(); state.dispose(); hub.dispose(); });
  return { hub, sessions, tui, state, view, get closed() { return closed; } };
}

test("daily flow: switching while composing never changes the recipient of a draft", async t => {
  const f = fixture(t); f.view.handleInput("\r"); f.view.handleInput("for A"); f.view.handleInput("\x1b[1;3B");
  assert.equal(f.state.selectedId, "w1"); assert.equal(f.state.thread("w1").editor.getExpandedText(), "");
  f.view.handleInput("for B"); await f.view.send();
  assert.deepEqual(f.sessions[1].calls, [["steer", "for B"]]); assert.deepEqual(f.sessions[0].calls, []);
  f.view.handleInput("\x1b[1;3A"); assert.equal(f.state.thread("w0").editor.getExpandedText(), "for A");
});
test("daily flow: multiline Unicode paste and ordinary cursor editing remain intact", async t => {
  const f = fixture(t); f.view.handleInput("\r");
  const text = Array.from({ length: 30 }, (_, i) => `line ${i} 中文`).join("\n");
  f.view.handleInput(`\x1b[200~${text}\x1b[201~`); await f.view.send();
  assert.equal(f.sessions[0].calls[0][1], text);
  f.view.handleInput("ab"); f.view.handleInput("\x1b[D"); f.view.handleInput("?");
  assert.equal(f.state.mode, "thread"); assert.equal(f.state.thread("w0").editor.getExpandedText(), "a?b");
});
test("daily flow: changing thread during enqueue keeps the receipt and later edits with their owner", async t => {
  const f = fixture(t), gate = deferred(); f.sessions[0].steer = async text => { await gate.promise; f.sessions[0].calls.push(["steer", text]); };
  f.view.handleInput("\r"); f.view.handleInput("first"); const send = f.view.send();
  f.view.handleInput(" plus new"); f.view.handleInput("\x1b[1;3B"); f.view.handleInput("other draft");
  gate.resolve(); await send;
  assert.equal(f.state.thread("w0").editor.getExpandedText(), "first plus new");
  assert.equal(f.state.thread("w1").editor.getExpandedText(), "other draft");
  assert.equal(f.hub.get("w0").receipts[0].text, "first"); assert.equal(f.hub.get("w1").receipts.length, 0);
});
test("daily flow: completed worker during send retains the original instruction", async t => {
  const f = fixture(t), gate = deferred(); f.sessions[0].steer = () => gate.promise;
  f.view.handleInput("\r"); f.view.handleInput("do not lose me"); const send = f.view.send();
  f.hub.unregister("w0"); gate.resolve(); await send;
  assert.equal(f.state.thread("w0").editor.getExpandedText(), "do not lose me");
  assert.equal(f.hub.get("w0").receipts[0].state, "undelivered");
});
test("daily flow: reopening and navigating never restarts or stops a worker", t => {
  const f = fixture(t); f.view.handleInput("\r"); f.view.handleInput("kept draft"); f.view.handleInput("\x1ba");
  assert.equal(f.closed, 1); f.view.dispose();
  const next = new AgentHubView(f.tui, theme, f.hub, "session", () => {}, f.state); t.after(() => next.dispose());
  assert.equal(f.state.thread("w0").editor.getExpandedText(), "kept draft");
  assert.deepEqual(f.sessions.map(s => s.calls), [[], []]);
});
test("daily flow: all view modes fit resized terminals and preserve a visible escape route", t => {
  const f = fixture(t);
  for (const mode of ["roster", "thread", "help", "details", "messages"]) {
    f.state.mode = mode;
    for (const [width, height] of [[120, 40], [80, 24], [40, 12], [22, 8], [12, 4]]) {
      f.tui.terminal.rows = height;
      const lines = f.view.render(width);
      assert.ok(lines.length <= height, `${mode} ${width}x${height}`);
      assert.ok(lines.every(line => visibleWidth(line) <= width), `${mode}: overflow at ${width}`);
      assert.match(lines.join("\n"), /Esc/, `${mode}: escape route hidden`);
    }
  }
});
test("daily flow: too narrow a viewport must not accept invisible typing", t => {
  const f = fixture(t); f.view.handleInput("\r"); f.view.render(12); f.view.handleInput("invisible");
  assert.equal(f.state.thread("w0").editor.getExpandedText(), "");
});
test("daily flow: native full output remains inspectable beyond the old 420-character limit", t => {
  const f = fixture(t), record = f.hub.get("w0");
  record.messages = [{ role: "assistant", content: [{ type: "toolCall", id: "t", name: "bash", arguments: { command: "cargo test" } }] },
    { role: "toolResult", toolCallId: "t", toolName: "bash", content: [{ type: "text", text: `FIRST\n${"compiler evidence\n".repeat(200)}LAST` }], isError: true }];
  const renderer = new WorkerTranscript(f.tui, process.cwd()); t.after(() => renderer.dispose());
  const text = renderer.render(record, 70, 1000, { follow: false, expanded: true }).join("\n");
  assert.match(text, /FIRST/); assert.match(text, /LAST/); assert.doesNotMatch(text, /Renderer unavailable|Renderer failed/);
});
test("daily flow: history does not chase new output after scrolling away from live", t => {
  const f = fixture(t), record = f.hub.get("w0"), state = { follow: true, raw: true };
  record.messages = Array.from({ length: 80 }, (_, i) => ({ role: "user", content: `line ${i}` }));
  const renderer = new WorkerTranscript(f.tui, process.cwd()); t.after(() => renderer.dispose());
  renderer.render(record, 60, 10, state); renderer.scroll(-25, state);
  const before = renderer.render(record, 60, 10, state);
  record.messages.push({ role: "user", content: "new tail" });
  assert.deepEqual(renderer.render(record, 60, 10, state), before);
});
test("daily flow: disposed views release listeners and ignore later activity", async t => {
  const f = fixture(t); f.view.dispose();
  f.sessions[0].emit({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "late" }] } });
  await tick(); assert.equal(f.hub.get("w0").state, "working");
});
