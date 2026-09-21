import { ExtensionEditorComponent } from "@earendil-works/pi-coding-agent";

/** Pi's editor() does not accept a signal. Keep cancellation attached to the
 * actual native dialog, not just the promise waiting for its answer. */
export async function humanEditor(ctx, title, prefill = "", signal) {
  signal?.throwIfAborted();
  if (!ctx.hasUI) throw new Error("Human input requires interactive Pi.");
  let detach = () => {};
  try {
    const value = await ctx.ui.custom((tui, _theme, keys, done) => {
      let settled = false;
      const finish = answer => {
        if (settled) return;
        settled = true; detach(); done(answer);
      };
      const abort = () => finish(undefined);
      const component = new ExtensionEditorComponent(tui, keys, title, prefill, finish, () => finish(undefined));
      detach = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      const dispose = component.dispose?.bind(component);
      component.dispose = () => { detach(); dispose?.(); };
      // Mount before settling an abort that raced with component construction.
      if (signal?.aborted) queueMicrotask(abort);
      return component;
    });
    signal?.throwIfAborted();
    return value;
  } finally { detach(); }
}
