import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ReviewWorkspace } from "./review-workspace.ts";
import { attention } from "./attention.ts";
import { WorkspaceWeb } from "./workspace-web.ts";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";

const section = Type.Object({ id: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }),
  kind: Type.Union([Type.Literal("outcome"), Type.Literal("design"), Type.Literal("evidence"), Type.Literal("risk"), Type.Literal("system"), Type.Literal("code")]), body: Type.String({ minLength: 1 }) });
const decision = Type.Object({ id: Type.String({ minLength: 1 }), subject: Type.String({ minLength: 1 }), recommendation: Type.String({ minLength: 1 }), consequence: Type.String({ minLength: 1 }), kind: Type.Union([Type.Literal("choice"), Type.Literal("risk")]), ...attention });
const schema = Type.Object({ sections: Type.Array(section, { minItems: 2 }), decisions: Type.Array(decision), recommendation: Type.String({ minLength: 1 }), requestId: Type.Optional(Type.String()), reply: Type.Optional(Type.String()) });
export function registerReviewWorkspace(pi: ExtensionAPI, reviewActive: () => boolean, web: WorkspaceWeb = new WorkspaceWeb()) {
  let store: ReviewWorkspace | undefined, session = "", restoring: Promise<void> = Promise.resolve();
  const fileFor = (next: ExtensionContext) => join(homedir(), ".pi", "agent", "review-workspaces", createHash("sha256").update(`${next.cwd}\0${next.sessionManager.getSessionId()}`).digest("hex") + ".json");
  const setContext = async (next: ExtensionContext) => {
    const key = fileFor(next); if (key === session && store) { await restoring; return; }
    session = key; const target = new ReviewWorkspace(next.cwd, key); store = target;
    restoring = (async () => {
      await target.restore();
      const marker = next.sessionManager.getBranch().some(entry => entry.type === "custom" && entry.customType === "dev-review-workspace");
      if (marker && !target.state.current && !target.state.notice) {
        target.state.notice = "Saved review workspace is missing. Earlier discussion, decisions, and drafts are unavailable; no approval is assumed.";
        target.state.recovered = true;
      }
    })(); await restoring;
  };
  const mark = async (next: ExtensionContext) => {
    if (!next.sessionManager.getBranch().some(entry => entry.type === "custom" && entry.customType === "dev-review-workspace")) pi.appendEntry?.("dev-review-workspace", { version: 1 });
    await store?.persist();
  };
  const show = async (next: ExtensionContext) => {
    await setContext(next); await mark(next);
    if (!store) throw new Error("Review workspace unavailable");
    const target = store;
    const url = await web.open({ phase: "review", store: target, project: next.cwd.split("/").pop() || next.cwd, active: reviewActive,
      send: (id, subject, text, version) => {
        if (!reviewActive()) throw new Error("Review goal not active");
        pi.sendUserMessage(`Review workspace request ${id} (subject: ${subject}, assessment version: ${version}). Reply inside the web workspace using review_reply with requestId and reply, or review_publish with requestId and reply if the assessment changed. The human wrote:\n${text}`);
      } });
    next.ui.notify(`Review workspace: ${url} · reopen with /dev-review-view or Alt+R`, "info");
    try { await web.launch(url); } catch (error) { next.ui.notify(`Browser did not open: ${String(error)}. Open ${url} manually.`, "warning"); }
  };
  pi.registerCommand("dev-review-view", { description: "Open local web review workspace", handler: async (_args, next) => { void show(next).catch(error => next.ui.notify(String(error), "error")); } });
  pi.registerShortcut("alt+r", { description: "Open local web review workspace", handler: next => { void show(next).catch(error => next.ui.notify(String(error), "error")); } });
  pi.registerTool({ name: "review_publish", label: "Publish review assessment", parameters: schema,
    description: "Publish outcome, evidence and recommendation as a concise human decision surface. For each consequential decision provide a semantic subject, consequence and recommendation; optionally add item-specific context and a semantic visual. Keep code and detailed evidence in on-demand context. For a pending request include requestId and reply. Updates await human inspection and application.",
    async execute(_id, args, _signal, _update, next) {
      if (!reviewActive()) throw new Error("Only an active dev-review goal may publish."); await setContext(next);
      if (!store) throw new Error("Review workspace unavailable");
      if (new Set(args.sections.map(s => s.id)).size !== args.sections.length || new Set(args.decisions.map(d => d.id)).size !== args.decisions.length) throw new Error("Section and decision IDs must be unique.");
      if (args.requestId && !args.reply?.trim()) throw new Error("A contextual request needs an in-workspace reply.");
      if (args.requestId && !store.state.discussions.some(m => m.id === args.requestId && m.status === "queued")) throw new Error("Request not pending.");
      await mark(next); const assessment = await store.publish({ sections: args.sections, decisions: args.decisions, recommendation: args.recommendation });
      if (args.requestId) await store.answer(args.requestId, args.reply!);
      return { content: [{ type: "text" as const, text: `Review assessment ${assessment.version} saved. ${store.state.pending ? "Update awaits human inspection." : "Visible in webpage."}` }], details: { version: assessment.version } };
    },
  });
  pi.registerTool({ name: "review_reply", label: "Reply in review workspace", parameters: Type.Object({ requestId: Type.String(), reply: Type.String({ minLength: 1 }) }),
    description: "Answer a pending contextual request in the Review webpage without replacing the assessment. Publish an update when material facts change.",
    async execute(_id, args, _signal, _update, next) {
      if (!reviewActive()) throw new Error("Only an active dev-review goal may reply."); await setContext(next);
      if (!store?.state.discussions.some(m => m.id === args.requestId && m.status === "queued")) throw new Error("Request is not pending.");
      await store.answer(args.requestId, args.reply);
      return { content: [{ type: "text" as const, text: "Reply delivered in Review webpage." }], details: undefined };
    },
  });
  pi.on("session_start", (_event, next) => { void setContext(next).catch(error => next.ui.notify(`Review restoration failed: ${String(error)}`, "warning")); });
  return { setContext, show, getStore: () => store };
}
