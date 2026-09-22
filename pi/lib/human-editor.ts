import { ExtensionEditorComponent, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

interface RecoverableEditor extends Component {
  getExpandedText(): string;
  setText(text: string): void;
}

const isRecoverableEditor = (value: Component): value is RecoverableEditor => {
  const candidate = value as Partial<RecoverableEditor>;
  return typeof candidate.getExpandedText === "function" && typeof candidate.setText === "function";
};

/** Cancel the actual native editor, not just the caller awaiting its result. */
export async function humanEditor(
  ctx: Pick<ExtensionContext, "hasUI" | "ui">,
  title: string,
  prefill = "",
  signal?: AbortSignal,
): Promise<string | undefined> {
  signal?.throwIfAborted();
  if (!ctx.hasUI) throw new Error("Human input requires interactive Pi.");
  let detach: () => void = () => undefined;
  let unsent = "";
  try {
    const value = await ctx.ui.custom<string | undefined>((tui, _theme, keys, done) => {
      let settled = false;
      let editor: RecoverableEditor | undefined;
      const finish = (answer: string | undefined): void => {
        if (settled) return;
        settled = true;
        if (answer === undefined) unsent = editor?.getExpandedText() ?? "";
        detach();
        done(answer);
      };
      const abort = (): void => finish(undefined);
      const component: ExtensionEditorComponent & { dispose?: () => void } = new ExtensionEditorComponent(tui, keys, title, prefill, finish, abort);
      // Public Container children and Editor API, never private editor fields.
      editor = component.children.find(isRecoverableEditor);
      if (!editor) throw new Error("Pinned Pi editor is unavailable; refusing to open an unrecoverable response editor.");
      detach = (): void => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      const dispose = component.dispose?.bind(component);
      component.dispose = (): void => { detach(); dispose?.(); };
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
