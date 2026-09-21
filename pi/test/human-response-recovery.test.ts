import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { humanEditor } from "../lib/human-editor.ts";
initTheme("dark", false);
function fixture() {
  let component;
  const pasted = [], notices = [];
  const ctx = { hasUI: true, ui: {
    custom(factory) { return new Promise(resolve => {
      component = factory({ terminal: { rows: 24, columns: 80 }, requestRender() {} }, {}, { matches: () => false }, resolve);
      component.focused = true;
    }); },
    pasteToEditor(text) { pasted.push(text); }, notify(text) { notices.push(text); },
  } };
  return { ctx, pasted, notices, get component() { return component; } };
}
test("cancelling a native human response preserves expanded multiline text without sending", async () => {
  const f = fixture(), abort = new AbortController(), answer = humanEditor(f.ctx, "API question", "", abort.signal);
  const text = Array.from({ length: 30 }, (_, i) => `line ${i} 中文`).join("\n");
  f.component.handleInput(`\x1b[200~${text}\x1b[201~`); abort.abort();
  await assert.rejects(answer, /abort/i);
  assert.ok(f.pasted[0].includes(text)); assert.equal(f.pasted.length, 1);
  f.component.dispose();
});
test("Esc preserves the answer alongside Main's existing draft via paste, not replacement", async () => {
  const f = fixture(), answer = humanEditor(f.ctx, "Question");
  f.component.handleInput("keep this reply"); f.component.handleInput("\x1b");
  assert.equal(await answer, undefined); assert.match(f.pasted[0], /keep this reply/); f.component.dispose();
});
test("submitting a native answer does not duplicate it into Main", async () => {
  const f = fixture(), abort = new AbortController(), answer = humanEditor(f.ctx, "Question", "", abort.signal);
  f.component.handleInput("ab"); f.component.handleInput("\x1b[D"); f.component.handleInput("?");
  f.component.handleInput("\r"); assert.equal(await answer, "a?b");
  abort.abort(); assert.deepEqual(f.pasted, []); f.component.dispose();
});
test("pre-cancelled request never opens or mutates any editor", async () => {
  const f = fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(humanEditor(f.ctx, "Question", "", abort.signal), /abort/i);
  assert.equal(f.component, undefined); assert.deepEqual(f.pasted, []);
});
