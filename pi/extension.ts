import type { ExtensionAPI, ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { asyncExploreTool, asyncReviewTool, createWorkerRunner, renderAsyncWorkerCompletion, type AsyncWorkerCompletion } from "./lib/worker.ts";
import path from "node:path";
import { buildHandoffTool, handoffFile } from "./lib/ship-handoff.ts";
import { ShipStore } from "./lib/ship-store.ts";
import { shipObserveTool } from "./lib/ship-observe-tool.ts";
import { abortActiveShipWait, shipActionTool } from "./lib/ship-action.ts";
import { WorkerHub, isActive } from "./lib/worker-hub.ts";
import { WorkerHistory } from "./lib/worker-history.ts";
import { registerWorkerHubUI } from "./worker-hub-ui.ts";
import type { WorkerHistory as WorkerHistoryStore } from "./lib/worker-history.ts";
import type { RegisterWorker, WorkerPatch, WorkerState } from "./lib/worker-types.ts";
import type { PublicPhase } from "./lib/roles.ts";
import { reconcileShipTodos } from "./lib/ship-todo.ts";

export const explorerOnlyTools = new Set(["web_search", "source_check", "fetch_content", "get_search_content"]);
const mainReaders = new Set(["read", "grep", "find", "ls", "explore", "review", "vcc_recall", "ask_user_question"]);

type HubUI = ReturnType<typeof registerWorkerHubUI>;
type WorkerRunner = ReturnType<typeof createWorkerRunner>;
interface ExtensionDependencies {
  hub?: WorkerHub;
  createWorkerRunner?: typeof createWorkerRunner;
  registerWorkerHubUI?: typeof registerWorkerHubUI;
}
interface ExternalWorkerRequest {
  sessionId: string;
  receive(adapter: {
    createSessionManager(cwd: string, metadata: Record<string, unknown>): SessionManager;
    register(record: RegisterWorker): { update(patch: WorkerPatch): void; finish(state?: WorkerState): void };
  }): void;
}
const isExternalWorkerRequest = (value: unknown): value is ExternalWorkerRequest => !!value && typeof value === "object" && typeof (value as Partial<ExternalWorkerRequest>).sessionId === "string" && typeof (value as Partial<ExternalWorkerRequest>).receive === "function";

/** Current-conversation role aliases and isolated read-only child tools. */
export default function extension(pi: ExtensionAPI, dependencies: ExtensionDependencies = {}): void {
  let ctx: ExtensionContext | undefined, history: WorkerHistoryStore | undefined;
  let closing = false, phase: PublicPhase | undefined;
  const setPhase = (next: PublicPhase | undefined): void => {
    phase = next;
    const active = pi.getActiveTools();
    const tools = active.filter(name => name !== "review");
    if (next === "ship") tools.push("review");
    if (tools.length !== active.length || tools.some((name, index) => name !== active[index])) pi.setActiveTools(tools);
  };
  const lifetime = new AbortController();
  const warn = (error: unknown): void => { if (!closing) ctx?.ui.notify(`Agent Hub: ${error instanceof Error ? error.message : String(error)}`, "warning"); };
  const hub = dependencies.hub || new WorkerHub({ onError: warn });
  const askHuman = ({ ownerId, question, choices }: { ownerId: string; question: string; choices?: string[] }, signal?: AbortSignal) => hub.request({
    ownerId,
    title: choices?.length ? `${question}\nChoices: ${choices.join(" · ")}` : question,
    run: async (response: unknown) => {
      if (!response || typeof response !== "object" || typeof (response as { answer?: unknown }).answer !== "string") throw new Error("Human response must contain an answer.");
      return (response as { answer: string }).answer;
    },
  }, signal);
  const run: WorkerRunner = (dependencies.createWorkerRunner || createWorkerRunner)({ hub, getHistory: () => history, askHuman });
  hub.onRelated = (record, text) => run.related(record, text);
  const writesOwned = (): boolean => hub.list().some(r => isActive(r) && !r.metadata["readOnly"]);
  const ownershipMessage = "Main is read-only while a writing child owns this worktree. Alt+A opens that agent. Wait for it to finish or stop it before editing.";
  const hubUI: HubUI = (dependencies.registerWorkerHubUI || registerWorkerHubUI)(pi, hub);

  pi.on("session_start", async (_event, nextCtx) => {
    ctx = nextCtx;
    setPhase(undefined);
    history = new WorkerHistory(ctx.sessionManager as unknown as ConstructorParameters<typeof WorkerHistory>[0], warn);
    hub.setHistory(history); hubUI.setContext(ctx);
    await history.restore(hub, lifetime.signal);
  });
  const unlisten = pi.events?.on("dev:worker-hub", (request: unknown) => {
    const parentId = ctx?.sessionManager.getSessionId();
    if (closing || !parentId || !isExternalWorkerRequest(request) || request.sessionId !== parentId) return;
    const valid = () => { if (closing || ctx?.sessionManager.getSessionId() !== parentId) throw new Error("Parent session changed."); };
    request.receive({
      createSessionManager(cwd: string, metadata: Record<string, unknown>) { valid(); if (!history) throw new Error("Worker history is unavailable."); return history.create(cwd, metadata); },
      register(record: RegisterWorker) {
        valid();
        if (!record.id || !record.session) throw new Error("Register an id and an externally-owned AgentSession.");
        hub.register({ ...record, metadata: { ...record.metadata, external: true } });
        return { update(patch: WorkerPatch) { valid(); hub.update(record.id, patch); }, finish(state: WorkerState = "completed") { valid(); hub.unregister(record.id, state); } };
      },
    });
  });

  const publishWorkerCompletion = (completion: AsyncWorkerCompletion): void => {
    if (closing) return;
    const content = renderAsyncWorkerCompletion(completion);
    try {
      pi.sendMessage({ customType: "dev-worker-result", content, display: true, details: completion }, { triggerTurn: true, deliverAs: "steer" });
    } catch (error) { warn(error); }
  };
  pi.registerTool(asyncExploreTool(run, publishWorkerCompletion));
  pi.registerTool(asyncReviewTool(run, publishWorkerCompletion));
  pi.registerTool(buildHandoffTool());
  pi.registerTool(shipObserveTool(cwd => new ShipStore(path.dirname(handoffFile(cwd))).loadInvocation()));
  pi.registerTool(shipActionTool(run, publishWorkerCompletion));
  pi.on("tool_call", event => {
    if (event.toolName === "ship_observe" && phase !== "ship") return { block: true, reason: "Ship observation requires an explicit dev-ship invocation." };
    if (event.toolName === "review" && phase !== "ship") return { block: true, reason: "The review tool is reserved for an explicit dev-ship invocation." };
    if (explorerOnlyTools.has(event.toolName)) return { block: true, reason: `Delegate ${event.toolName} to one or more narrowly scoped explore calls.` };
    if (writesOwned() && !mainReaders.has(event.toolName)) return { block: true, reason: ownershipMessage };
    return undefined;
  });
  pi.on("user_bash", () => writesOwned() ? { result: { output: ownershipMessage, exitCode: 1, cancelled: false, truncated: false } } : undefined);
  const preventSessionChange = (): { cancel: true } | undefined => {
    if (run.hasActive() || hub.list().some(isActive)) {
      ctx?.ui.notify("Stop active work before changing the parent session. Histories and drafts will be preserved.", "warning");
      return { cancel: true };
    }
    return undefined;
  };
  pi.on("session_start", (_event, nextCtx) => {
    const state = new ShipStore(path.dirname(handoffFile(nextCtx.cwd))).load()?.state;
    if (state) reconcileShipTodos(nextCtx.sessionManager.getSessionFile() ?? `ship:${nextCtx.cwd}`, state);
  });
  pi.on("session_before_switch", preventSessionChange);
  pi.on("session_before_fork", preventSessionChange);
  pi.on("input", event => {
    if (event.streamingBehavior === "steer") abortActiveShipWait();
    const match = /^\/skill:dev-(spec|plan|build|ship)(?:\s|$)/.exec(event.text);
    if (match?.[1]) setPhase(match[1] as PublicPhase);
    return { action: "continue" };
  });

  for (const commandPhase of ["spec", "plan", "build", "ship"] as const) pi.registerCommand(`dev-${commandPhase}`, {
    description: `Invoke dev-${commandPhase} in the current conversation`,
    handler: async (args, nextCtx) => {
      ctx = nextCtx;
      if (writesOwned()) { nextCtx.ui.notify(ownershipMessage, "warning"); return; }
      setPhase(commandPhase);
      hubUI.setContext(nextCtx);
      const invocation = commandPhase === "ship" ? new ShipStore(path.dirname(handoffFile(nextCtx.cwd))).issueInvocation() : undefined;
      const invocationContext = invocation ? `\n\nCommand-issued ship invocation ID: ${invocation}` : "";
      pi.sendUserMessage(`/skill:dev-${commandPhase}${args ? ` ${args}` : ""}${invocationContext}`, { expandPromptTemplates: true });
    },
  });
  pi.on("session_shutdown", async () => {
    closing = true; abortActiveShipWait(); lifetime.abort();
    await Promise.allSettled(hub.list().filter(isActive).map(r => hub.abort(r.id)));
    await run.stopAll(); hub.flush(); unlisten?.(); hubUI.dispose(); hub.dispose();
  });
}
