import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ReviewWorkspace } from "./review-workspace.ts";
import { ReviewWorkspaceView } from "../review-workspace-ui.ts";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";

const section = Type.Object({ id: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }),
  kind: Type.Union([Type.Literal("outcome"), Type.Literal("design"), Type.Literal("evidence"), Type.Literal("risk"), Type.Literal("system"), Type.Literal("code")]),
  body: Type.String({ minLength: 1 }) });
const decision = Type.Object({ id: Type.String({ minLength: 1 }), subject: Type.String({ minLength: 1 }),
  recommendation: Type.String({ minLength: 1 }), consequence: Type.String({ minLength: 1 }), kind: Type.Union([Type.Literal("choice"), Type.Literal("risk")]) });
const schema = Type.Object({ sections: Type.Array(section, { minItems: 2 }), decisions: Type.Array(decision), recommendation: Type.String({ minLength: 1 }),
  requestId: Type.Optional(Type.String()), reply: Type.Optional(Type.String()) });
/** An agent-authored assessment feeds an independent, candidate-bound human review surface. */
export function registerReviewWorkspace(pi: ExtensionAPI, reviewActive: () => boolean) {
  let ctx: ExtensionContext | undefined;
  let store: ReviewWorkspace | undefined;
  let open: Promise<void> | undefined;
  let close: (() => void) | undefined;
  let session = "";
  let restoring: Promise<void> = Promise.resolve();
  const fileFor = (next: ExtensionContext) => {
    const key = `${next.cwd}\0${next.sessionManager.getSessionId()}`;
    return join(homedir(), ".pi", "agent", "review-workspaces", createHash("sha256").update(key).digest("hex") + ".json");
  };
  const setContext = async (next: ExtensionContext) => {
    ctx = next;
    const key = fileFor(next);
    if (key === session && store) { await restoring; return; }
    close?.(); session = key;
    const target = new ReviewWorkspace(next.cwd, key);
    store = target;
    restoring = (async () => {
      await target.restore();
      const marker = next.sessionManager.getBranch().some(entry => entry.type === "custom" && entry.customType === "dev-review-workspace");
      if (marker && !target.state.current && !target.state.notice) {
        target.state.notice = "Saved review workspace is missing. Earlier discussion, decisions, and drafts are unavailable; no approval is assumed.";
        target.state.recovered = true;
      }
    })();
    await restoring;
  };
  const mark = async (next: ExtensionContext) => {
    if (!next.sessionManager.getBranch().some(entry => entry.type === "custom" && entry.customType === "dev-review-workspace")) pi.appendEntry?.("dev-review-workspace", { version: 1 });
    await store?.persist();
  };
  const show = async (next: ExtensionContext) => {
    await setContext(next);
    await mark(next);
    if (next.mode !== "tui" || !store) { next.ui.notify("Review workspace requires interactive terminal mode.", "warning"); return; }
    if (open) { close?.(); return; }
    const target = store;
    let view: ReviewWorkspaceView | undefined;
    open = next.ui.custom<void>((tui, theme, _keys, done) => {
      close = () => done();
      view = new ReviewWorkspaceView(tui, theme, target, close, (id, subject, text) => {
        if (!reviewActive()) throw new Error("Review goal is not active. Resume it before submitting.");
        pi.sendUserMessage(`Review workspace request ${id} (subject: ${subject}, assessment version: ${target.state.current?.version || "unassessed"}). Reply inside the review workspace using review_reply with requestId and reply, or review_publish with requestId and reply if the assessment changed. The human wrote:\n${text}`);
      }, reviewActive);
      return view;
    }, { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 } });
    try { await open; } finally { view?.dispose(); open = undefined; close = undefined; }
  };
  pi.registerCommand("dev-review-view", { description: "Open or close the dedicated terminal review workspace", handler: async (_args, next) => { void show(next).catch(error => next.ui.notify(String(error), "error")); } });
  pi.registerShortcut("alt+r", { description: "Open or close review workspace", handler: next => { void show(next).catch(error => next.ui.notify(String(error), "error")); } });
  pi.registerTool({ name: "review_publish", label: "Publish review assessment", parameters: schema,
    description: "Publish a structured CTO-facing assessment into the dedicated terminal review workspace. Include outcome, evidence, design/risk/system/code subjects as relevant, a clear recommendation, and open consequential decisions. When responding to a workspace request, include its exact requestId and a contextual reply. Publishing a new assessment leaves the reader's current version in place until they apply the update.",
    async execute(_id, args, _signal, _update, next) {
      if (!reviewActive()) throw new Error("Only an active dev-review goal may publish a review assessment.");
      await setContext(next);
      if (!store) throw new Error("Review workspace unavailable");
      if (new Set(args.sections.map(s => s.id)).size !== args.sections.length || new Set(args.decisions.map(d => d.id)).size !== args.decisions.length) throw new Error("Section and decision IDs must be unique.");
      if (args.requestId && !args.reply?.trim()) throw new Error("A contextual request needs an in-workspace reply.");
      if (args.requestId && !store.state.discussions.some(m => m.id === args.requestId && m.status === "queued")) throw new Error("Request not pending; do not silently replay a failed or historical request.");
      await mark(next);
      const assessment = await store.publish({ sections: args.sections, decisions: args.decisions, recommendation: args.recommendation });
      if (args.requestId) await store.answer(args.requestId, args.reply!);
      return { content: [{ type: "text" as const, text: `Review assessment ${assessment.version} saved for candidate ${assessment.candidate.head}. ${store.state.pending ? "Update awaiting human inspection." : "Visible in review workspace."}` }], details: { version: assessment.version } };
    },
  });
  pi.registerTool({ name: "review_reply", label: "Reply in review workspace", parameters: Type.Object({ requestId: Type.String(), reply: Type.String({ minLength: 1 }) }),
    description: "Reply to a specific pending human discussion in the terminal review workspace without replacing the assessment. Use review_publish instead if the candidate, evidence, risks or recommendation materially changed.",
    async execute(_id, args, _signal, _update, next) {
      if (!reviewActive()) throw new Error("Only an active dev-review goal may reply.");
      await setContext(next);
      if (!store?.state.discussions.some(m => m.id === args.requestId && m.status === "queued")) throw new Error("Request is not pending; never replay a failed or historical submission.");
      await store.answer(args.requestId, args.reply);
      return { content: [{ type: "text" as const, text: "Reply delivered in the review workspace." }], details: undefined };
    },
  });
  pi.on("session_start", (_event, next) => { void setContext(next).catch(error => next.ui.notify(`Review restoration failed: ${String(error)}`, "warning")); });
  pi.on("session_before_switch", () => close?.());
  pi.on("session_before_fork", () => close?.());
  pi.on("session_shutdown", () => { close?.(); });
  return { setContext, show, getStore: () => store };
}
