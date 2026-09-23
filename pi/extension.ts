import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { asyncExploreTool, asyncReviewTool, createWorkerRunner, renderAsyncWorkerCompletion, type AsyncWorkerCompletion } from "./lib/worker.ts";
import { WorkerHub } from "./lib/worker-hub.ts";
import { WorkerHistory } from "./lib/worker-history.ts";
import { registerWorkerHubUI } from "./worker-hub-ui.ts";
import type { WorkerHistory as WorkerHistoryStore } from "./lib/worker-history.ts";
import type { PublicPhase } from "./lib/roles.ts";
import { registerCompletionGuard } from "./lib/completion-guard.ts";

export const explorerOnlyTools = new Set(["web_search", "source_check", "fetch_content", "get_search_content"]);
type HubUI = ReturnType<typeof registerWorkerHubUI>;
type WorkerRunner = ReturnType<typeof createWorkerRunner>;
interface ExtensionDependencies {
  hub?: WorkerHub;
  createWorkerRunner?: typeof createWorkerRunner;
  registerWorkerHubUI?: typeof registerWorkerHubUI;
}
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
  const run: WorkerRunner = (dependencies.createWorkerRunner || createWorkerRunner)({ hub, getHistory: () => history, ownerCwd: () => ctx?.cwd, askHuman });
  hub.onRelated = (record, text) => run.related(record, text);
  const hubUI: HubUI = (dependencies.registerWorkerHubUI || registerWorkerHubUI)(pi, hub);
  const guard = registerCompletionGuard(pi, run, () => run.hasActive());

  pi.on("session_start", async (_event, nextCtx) => {
    ctx = nextCtx;
    setPhase(undefined);
    history = new WorkerHistory(ctx.sessionManager as unknown as ConstructorParameters<typeof WorkerHistory>[0], warn);
    hub.setHistory(history); hubUI.setContext(ctx);
    await history.restore(hub, lifetime.signal);
  });
  const publishWorkerCompletion = (completion: AsyncWorkerCompletion): void => {
    if (closing || (completion.ownerSessionId && completion.ownerSessionId !== ctx?.sessionManager.getSessionId())) return;
    const content = renderAsyncWorkerCompletion(completion);
    try {
      pi.sendMessage({ customType: "dev-worker-result", content, display: true, details: completion }, { triggerTurn: true, deliverAs: "steer" });
    } catch (error) { warn(error); }
  };
  const currentSession = (): string | undefined => ctx?.sessionManager.getSessionId();
  pi.registerTool(asyncExploreTool(run, publishWorkerCompletion, undefined, undefined, {}, currentSession));
  pi.registerTool(asyncReviewTool(run, publishWorkerCompletion, undefined, currentSession));
  pi.on("tool_call", event => {
    if (event.toolName === "review" && phase !== "ship") return { block: true, reason: "Review is reserved for an explicit dev-ship invocation." };
    if (explorerOnlyTools.has(event.toolName)) return { block: true, reason: `Delegate ${event.toolName} to one or more narrowly scoped explore calls.` };
    return undefined;
  });
  const stopForSessionChange = (): void => {
    // Workers own disposable read-only snapshots. Request cancellation without
    // making session navigation depend on an unresponsive child or its cleanup.
    void run.stopAll().catch(warn);
  };
  pi.on("session_before_switch", stopForSessionChange);
  pi.on("session_before_fork", stopForSessionChange);
  pi.on("input", (event, nextCtx) => {
    const match = /^\/skill:dev-(spec|build|ship)(?:\s|$)/.exec(event.text);
    if (match?.[1]) {
      setPhase(match[1] as PublicPhase);
      if ((match[1] === "build" || match[1] === "ship") && nextCtx?.sessionManager) guard.activate(event.text, match[1], nextCtx);
    }
    return { action: "continue" };
  });

  for (const commandPhase of ["spec", "build", "ship"] as const) pi.registerCommand(`dev-${commandPhase}`, {
    description: `Invoke dev-${commandPhase} in the current conversation`,
    handler: async (args, nextCtx) => {
      ctx = nextCtx;
      setPhase(commandPhase);
      hubUI.setContext(nextCtx);
      pi.sendUserMessage(`/skill:dev-${commandPhase}${args ? ` ${args}` : ""}`, { expandPromptTemplates: true });
    },
  });
  pi.on("session_shutdown", async () => {
    closing = true; lifetime.abort();
    await run.stopAll(); hub.flush(); hubUI.dispose(); hub.dispose();
  });
}
