import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { join, resolve, relative, basename } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { SpecWorkspace } from "./spec-workspace.ts";
import { attention } from "./attention.ts";
import { WorkspaceWeb } from "./workspace-web.ts";

const section = Type.Object({ id: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }), kind: Type.Union([Type.Literal("motivation"), Type.Literal("requirement"), Type.Literal("question"), Type.Literal("scope"), Type.Literal("evidence")]), body: Type.String({ minLength: 1 }) });
const decision = Type.Object({ id: Type.String({ minLength: 1 }), subject: Type.String({ minLength: 1 }), recommendation: Type.String({ minLength: 1 }), consequence: Type.String({ minLength: 1 }), ...attention });
export function registerSpecWorkspace(pi: ExtensionAPI, specActive: () => boolean, web: WorkspaceWeb) {
  let store: SpecWorkspace | undefined, session = "", restoring: Promise<void> = Promise.resolve();
  const marker = (next: ExtensionContext) => [...next.sessionManager.getBranch()].reverse().find(e => e.type === "custom" && e.customType === "dev-spec-workspace");
  const fileFor = (next: ExtensionContext) => join(homedir(), ".pi", "agent", "spec-workspaces", createHash("sha256").update(`${next.cwd}\0${next.sessionManager.getSessionId()}`).digest("hex") + ".json");
  const pathFor = (next: ExtensionContext, request?: string): string => {
    const saved = marker(next);
    const value = request?.match(/(?:\.\/)?plans\/[\w.-]+\/spec\.md/)?.[0] || (saved?.type === "custom" && saved.data && typeof saved.data === "object" ? (saved.data as { path?: string }).path : undefined) || `plans/${basename(resolve(next.cwd))}/spec.md`; 
    const path = resolve(next.cwd, value);
    if (relative(resolve(next.cwd), path).startsWith("..") || basename(path) !== "spec.md") throw new Error("Spec path must be a project spec.md");
    return path;
  };
  const setContext = async (next: ExtensionContext, request?: string) => {
    const path = pathFor(next, request), key = fileFor(next);
    if (session === key && store && store.path === path) { await restoring; return; }
    session = key; const target = new SpecWorkspace(path, key, next.cwd); store = target;
    restoring = (async () => {
      await target.restore();
      if (marker(next) && !target.state.current && !target.state.notice) {
        target.state.notice = "Saved spec workspace missing. Earlier discussions and decisions are unavailable; no approval is assumed.";
        target.state.recovered = true;
      }
    })(); await restoring;
  };
  const show = async (next: ExtensionContext, request?: string) => {
    await setContext(next, request);
    if (!store) throw new Error("Spec workspace unavailable");
    if (!marker(next)) pi.appendEntry?.("dev-spec-workspace", { version: 1, path: relative(next.cwd, store.path) });
    await store.persist(); const target = store;
    const url = await web.open({ phase: "spec", store: target, project: basename(resolve(next.cwd)), active: specActive,
      send: (id, subject, text, version) => {
        if (!specActive()) throw new Error("Spec goal not active");
        pi.sendUserMessage(`Spec workspace request ${id} (subject: ${subject}, spec version: ${version}). Respond in the web workspace with spec_reply and exact requestId, or spec_publish with requestId and reply when material semantics change. The human wrote:\n${text}`);
      } });
    next.ui.notify(`Spec workspace: ${url} · reopen with /dev-spec-view or Alt+S`, "info");
    try { await web.launch(url); } catch (error) { next.ui.notify(`Browser did not open: ${String(error)}. Open ${url} manually.`, "warning"); }
  };
  pi.registerCommand("dev-spec-view", { description: "Open local web Spec workspace", handler: async (_args, next) => { void show(next).catch(error => next.ui.notify(String(error), "error")); } });
  pi.registerShortcut("alt+s", { description: "Open local web Spec workspace", handler: next => { void show(next).catch(error => next.ui.notify(String(error), "error")); } });
  pi.registerTool({ name: "spec_publish", label: "Publish evolving spec", parameters: Type.Object({ sections: Type.Array(section, { minItems: 1 }), decisions: Type.Array(decision), recommendation: Type.String({ minLength: 1 }), requestId: Type.Optional(Type.String()), reply: Type.Optional(Type.String()) }),
    description: "Publish the durable Markdown spec and concise decision items to the local Spec webpage. Each consequential decision needs a human-readable subject, consequence and recommendation; optionally add item-specific context and a semantic visual. Keep evidence and code hidden until requested. If answering a pending request, include requestId and reply. Updates await inspection.",
    async execute(_id, args, _signal, _update, next) {
      if (!specActive()) throw new Error("Only an active dev-spec goal may publish."); await setContext(next);
      if (!store) throw new Error("Spec workspace unavailable");
      if (new Set(args.sections.map(s => s.id)).size !== args.sections.length || new Set(args.decisions.map(d => d.id)).size !== args.decisions.length) throw new Error("IDs must be unique");
      if (args.requestId && (!args.reply?.trim() || !store.state.discussions.some(m => m.id === args.requestId && m.status === "queued"))) throw new Error("Pending request and contextual reply required");
      const markdown = await readFile(store.path, "utf8");
      const doc = await store.publish({ sections: args.sections, decisions: args.decisions, recommendation: args.recommendation, markdown });
      if (args.requestId) await store.answer(args.requestId, args.reply!);
      return { content: [{ type: "text" as const, text: `Spec ${doc.version} saved. ${store.state.pending ? "Update awaits inspection." : "Visible in webpage."}` }], details: { version: doc.version } };
    },
  });
  pi.registerTool({ name: "spec_reply", label: "Reply in Spec workspace", parameters: Type.Object({ requestId: Type.String(), reply: Type.String({ minLength: 1 }) }),
    description: "Answer a pending Spec discussion inside the webpage. Material answers must also update the durable spec and published assessment.",
    async execute(_id, args, _signal, _update, next) {
      if (!specActive()) throw new Error("Only an active dev-spec goal may reply."); await setContext(next);
      if (!store?.state.discussions.some(m => m.id === args.requestId && m.status === "queued")) throw new Error("Request not pending");
      await store.answer(args.requestId, args.reply);
      return { content: [{ type: "text" as const, text: "Reply delivered in Spec webpage." }], details: undefined };
    },
  });
  pi.on("session_start", (_event, next) => { if (marker(next)) void setContext(next).catch(error => next.ui.notify(`Spec restoration failed: ${String(error)}`, "warning")); });
  return { setContext, show, getStore: () => store };
}
