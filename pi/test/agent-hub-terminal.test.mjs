import { test } from "node:test";
import assert from "node:assert/strict";
import { TuiMainScreen, TuiAltScreen, Editor, visibleWidth } from "@earendil-works/pi-tui";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { WorkerHub } from "../lib/worker-hub.mjs";
import { createJiti } from "jiti";
const { AgentHubView, createHubViewState } = await createJiti(import.meta.url).import("../worker-hub-ui.ts");
initTheme("dark", false);
const theme = { fg: (_c, t) => t, bg: (_c, t) => t, bold: t => t };
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
class MemoryTerminal {
  rows = 24; columns = 80; kittyProtocolActive = false; output = "";
  start(input, resize) { this.input = input; this.resize = resize; }
  stop() {} drainInput() { return Promise.resolve(); }
  write(data) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}

for (const Renderer of [TuiMainScreen, TuiAltScreen]) test(`native ${Renderer.name}: overlay focus, editing, steering and returning to the untouched Main editor`, async t => {
  const terminal = new MemoryTerminal(), tui = new Renderer(terminal), hub = new WorkerHub();
  const editorTheme = { borderColor: s => s, selectList: { selectedPrefix: s => s, selectedText: s => s, description: s => s, scrollInfo: s => s, noMatch: s => s } };
  const main = new Editor(tui, editorTheme); main.disableSubmit = true; main.setText("Main draft stays here");
  tui.addChild(main); tui.setFocus(main);
  const calls = [];
  for (const id of ["a", "b"]) hub.register({ id, label: `Explorer · ${id}`, role: "explorer", model: "luna", thinking: "medium", state: "working",
    metadata: { parentId: "main", task: "Inspect evidence", cwd: process.cwd() }, controls: { send: async text => calls.push([id, text]) } });
  const state = createHubViewState(hub); let overlay;
  const view = new AgentHubView(tui, theme, hub, "session", () => { overlay.hide(); tui.setFocus(main); }, state);
  t.after(() => { overlay?.hide(); view.dispose(); state.dispose(); hub.dispose(); tui.stop(); });
  tui.start();
  overlay = tui.showOverlay(view, { width: "100%", maxHeight: "100%", margin: 0 }); tui.setFocus(view);
  await pause();
  terminal.input("\r"); terminal.input("abc"); terminal.input("\x1b[D"); terminal.input("?");
  terminal.input("\x1b[1;3B"); terminal.input("for B"); terminal.input("\r");
  await pause();
  assert.deepEqual(calls, [["b", "for B"]]);
  assert.equal(state.thread("a").editor.getExpandedText(), "ab?c");
  assert.equal(main.getExpandedText(), "Main draft stays here");
  terminal.rows = 12; terminal.columns = 40; terminal.resize(); await pause();
  assert.ok(view.render(40).every(line => visibleWidth(line) <= 40));
  assert.ok(terminal.output.includes("Agent Hub"));
  terminal.input("\x1ba"); await pause();
  terminal.input("!");
  assert.equal(main.getExpandedText(), "Main draft stays here!");
  assert.equal(state.thread("a").editor.getExpandedText(), "ab?c");
});
