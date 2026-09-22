import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { humanEditor } from "../lib/human-editor.ts";
initTheme("dark", false);
type HumanContext = Parameters<typeof humanEditor>[0];
interface EditorFixtureComponent { focused: boolean; handleInput(text: string): void; dispose(): void }
type EditorFactory = (tui: { terminal: { rows: number; columns: number }; requestRender(): void }, theme: Record<string, never>, keys: { matches(): false }, done: (value: unknown) => void) => EditorFixtureComponent;
function fixture() {
  let component: EditorFixtureComponent | undefined;
  const pasted: string[] = [], notices: string[] = [];
  const rawContext = { hasUI: true, ui: {
    custom(factory: EditorFactory): Promise<unknown> { return new Promise(resolve => {
      component = factory({ terminal: { rows: 24, columns: 80 }, requestRender() {} }, {}, { matches: () => false }, resolve);
      component.focused = true;
    }); },
    pasteToEditor(text: string): void { pasted.push(text); }, notify(text: string): void { notices.push(text); },
  } };
  const ctx = rawContext as unknown as HumanContext;
  return { ctx, pasted, notices, get component(): EditorFixtureComponent | undefined { return component; } };
}
test("cancelling a native human response preserves expanded multiline text without sending", async () => {
  const f = fixture(), abort = new AbortController(), answer = humanEditor(f.ctx, "API question", "", abort.signal);
  const text = Array.from({ length: 30 }, (_, i) => `line ${i} 中文`).join("\n");
  const component=f.component; assert.ok(component); component.handleInput(`\x1b[200~${text}\x1b[201~`); abort.abort();
  await assert.rejects(answer, /abort/i);
  assert.ok(f.pasted[0]?.includes(text)); assert.equal(f.pasted.length, 1);
  component.dispose();
});
test("Esc preserves the answer alongside Main's existing draft via paste, not replacement", async () => {
  const f = fixture(), answer = humanEditor(f.ctx, "Question");
  const component=f.component; assert.ok(component); component.handleInput("keep this reply"); component.handleInput("\x1b");
  assert.equal(await answer, undefined); assert.match(f.pasted[0] ?? '', /keep this reply/); component.dispose();
});
test("submitting a native answer does not duplicate it into Main", async () => {
  const f = fixture(), abort = new AbortController(), answer = humanEditor(f.ctx, "Question", "", abort.signal);
  const component=f.component; assert.ok(component); component.handleInput("ab"); component.handleInput("\x1b[D"); component.handleInput("?");
  component.handleInput("\r"); assert.equal(await answer, "a?b");
  abort.abort(); assert.deepEqual(f.pasted, []); component.dispose();
});
test("pre-cancelled request never opens or mutates any editor", async () => {
  const f = fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(humanEditor(f.ctx, "Question", "", abort.signal), /abort/i);
  assert.equal(f.component, undefined); assert.deepEqual(f.pasted, []);
});
