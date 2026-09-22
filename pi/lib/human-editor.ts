import { ExtensionEditorComponent } from "@earendil-works/pi-coding-agent";

type EditorChild = {
  getExpandedText(): string;
  setText(text: string): void;
};
type HumanEditorContext = {
  hasUI: boolean;
  ui: {
    custom(
      render: (
        tui: ConstructorParameters<typeof ExtensionEditorComponent>[0],
        theme: unknown,
        keys: ConstructorParameters<typeof ExtensionEditorComponent>[1],
        done: (value: string | undefined) => void,
      ) => ExtensionEditorComponent,
    ): Promise<string | undefined>;
    pasteToEditor(text: string): void;
    notify(message: string, level: "info" | "warning" | "error"): void;
  };
};

const isEditorChild = (value: unknown): value is EditorChild => !!value && typeof value === "object"
  && typeof (value as Partial<EditorChild>).getExpandedText === "function"
  && typeof (value as Partial<EditorChild>).setText === "function";

/** Cancel the actual native editor, not just the caller awaiting its result. */
export async function humanEditor(
  ctx: HumanEditorContext,
  title: string,
  prefill = "",
  signal?: AbortSignal,
): Promise<string | undefined> {
  signal?.throwIfAborted();
  if (!ctx.hasUI) throw new Error("Human input requires interactive Pi.");
  let detach = () => {}, unsent = "";
  try {
    const value = await ctx.ui.custom((tui, _theme, keys, done) => {
      let settled = false;
      let editor: EditorChild | undefined;
      const finish = (answer: string | undefined) => {
        if (settled) return;
        settled = true;
        if (answer === undefined) unsent = editor?.getExpandedText() || "";
        detach(); done(answer);
      };
      const abort = () => finish(undefined);
      const component = new ExtensionEditorComponent(tui, keys, title, prefill, finish, () => finish(undefined));
      editor = component.children.find(isEditorChild) as EditorChild | undefined;
      if (!editor) throw new Error("Pinned Pi editor is unavailable; refusing to open an unrecoverable response editor.");
      detach = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      const disposable = component as ExtensionEditorComponent & { dispose?: () => void };
      const dispose = disposable.dispose?.bind(disposable);
      disposable.dispose = () => { detach(); dispose?.(); };
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
