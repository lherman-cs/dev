import { stripVTControlCharacters } from "node:util";
import { Editor, CURSOR_MARKER, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

/** Pi 0.86's ui.editor has no AbortSignal option. Use its native Editor in a
 * cancellable custom view so stopping a worker cannot strand a hidden dialog. */
export async function editHumanText(ctx, title, prefill = "", signal) {
  if (!ctx.hasUI) throw new Error("Human input requires interactive Pi.");
  signal?.throwIfAborted();
  return ctx.ui.custom((tui, theme, _keys, done) => {
    const editor = new Editor(tui, {
      borderColor: text => theme.fg("borderAccent", text),
      selectList: { selectedPrefix: text => text, selectedText: text => text, description: text => text,
        scrollInfo: text => text, noMatch: text => text },
    });
    editor.setText(prefill);
    editor.onSubmit = text => done(text);
    const abort = () => done(undefined);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) queueMicrotask(abort);
    return {
      get focused() { return editor.focused; },
      set focused(value) { editor.focused = value; },
      handleInput(data) {
        if (matchesKey(data, "escape")) done(undefined);
        else editor.handleInput(data);
        tui.requestRender();
      },
      render(width) {
        const rows = Math.max(3, tui.terminal?.rows || 24);
        const text = stripVTControlCharacters(title).replace(/[\r\n]/g, " ");
        let lines = editor.render(Math.max(1, width));
        if (lines.length > rows - 2) {
          const cursor = Math.max(0, lines.findIndex(line => line.includes(CURSOR_MARKER)));
          const start = Math.max(0, Math.min(cursor, lines.length - (rows - 2)));
          lines = lines.slice(start, start + rows - 2);
        }
        return [truncateToWidth(text, width), ...lines, truncateToWidth("Enter Submit · Esc Cancel", width)];
      },
      invalidate() { editor.invalidate(); },
      dispose() { signal?.removeEventListener("abort", abort); editor.focused = false; },
    };
  });
}
