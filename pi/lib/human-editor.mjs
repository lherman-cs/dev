import { ExtensionEditorComponent } from "@earendil-works/pi-coding-agent";

/** Cancel the actual native editor, not just the caller awaiting its result. */
export async function humanEditor(ctx, title, prefill = "", signal) {
  signal?.throwIfAborted();
  if (!ctx.hasUI) throw new Error("Human input requires interactive Pi.");
  let detach = () => {}, unsent = "";
  try {
    const value = await ctx.ui.custom((tui, _theme, keys, done) => {
      let settled = false, editor;
      const finish = answer => {
        if (settled) return;
        settled = true;
        if (answer === undefined) unsent = editor?.getExpandedText() || "";
        detach(); done(answer);
      };
      const abort = () => finish(undefined);
      const component = new ExtensionEditorComponent(tui, keys, title, prefill, finish, () => finish(undefined));
      // Public Container children and Editor API, never private editor fields.
      editor = component.children.find(child => typeof child.getExpandedText === "function" && typeof child.setText === "function");
      if (!editor) throw new Error("Pinned Pi editor is unavailable; refusing to open an unrecoverable response editor.");
      detach = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      const dispose = component.dispose?.bind(component);
      component.dispose = () => { detach(); dispose?.(); };
      if (signal?.aborted) queueMicrotask(abort);
      return component;
    });
    signal?.throwIfAborted();
    return value;
  } finally {
    detach();
    if (unsent.trim()) {
      ctx.ui.pasteToEditor(`\n\nUnsent response to ${title}:\n${unsent}\n`);
      ctx.ui.notify("Unsent response preserved in Main's draft; it was not sent.", "info");
    }
  }
}
