import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { asyncExploreTool, createWorkerRunner, renderAsyncWorkerCompletion, type AsyncWorkerCompletion } from "./lib/worker.ts";
import { WorkerHub } from "./lib/worker-hub.ts";
import { WorkerHistory } from "./lib/worker-history.ts";
import { registerWorkerHubUI } from "./worker-hub-ui.ts";
import type { WorkerHistory as WorkerHistoryStore } from "./lib/worker-history.ts";
import type { PublicPhase } from "./lib/roles.ts";
import { registerCompletionGuard } from "./lib/completion-guard.ts";
import { createVerifierTool } from "./lib/verifier.ts";
import { registerVerifier } from "./lib/verifier-hub.ts";
import { packageReviewedCandidate } from "./lib/ship.ts";

export const explorerOnlyTools = new Set(["web_search", "source_check", "fetch_content", "get_search_content"]);
type HubUI = ReturnType<typeof registerWorkerHubUI>;
type WorkerRunner = ReturnType<typeof createWorkerRunner>;
interface ExtensionDependencies {
  hub?: WorkerHub;
  createWorkerRunner?: typeof createWorkerRunner;
  registerWorkerHubUI?: typeof registerWorkerHubUI;
  packageReviewedCandidate?: typeof packageReviewedCandidate;
}
/** Current-conversation role aliases and isolated read-only child tools. */
export default function extension(pi: ExtensionAPI, dependencies: ExtensionDependencies = {}): void {
  let ctx: ExtensionContext | undefined, history: WorkerHistoryStore | undefined;
  let closing = false, phase: PublicPhase | undefined;
  const setPhase = (next: PublicPhase | undefined): void => {
    phase = next;
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
  const guard = registerCompletionGuard(pi, run);

  pi.on("session_start", async (_event, nextCtx) => {
    ctx = nextCtx;
    setPhase(undefined);
    history = new WorkerHistory(ctx.sessionManager as unknown as ConstructorParameters<typeof WorkerHistory>[0], warn);
    hub.setHistory(history); hubUI.setContext(ctx);
    await history.restore(hub, lifetime.signal);
  });
  const publishWorkerCompletion = (completion: AsyncWorkerCompletion): void => {
    if (closing || (completion.ownerSessionId && completion.ownerSessionId !== ctx?.sessionManager.getSessionId())) return;
    const owner = completion.ownerGoal ?? "";
    if (!guard.workerFinished(completion.id, owner)) return;
    const content = renderAsyncWorkerCompletion(completion);
    try {
      pi.sendMessage({ customType: "dev-worker-result", content, display: true, details: completion }, { triggerTurn: true, deliverAs: "steer" });
    } catch (error) { guard.workerDeliveryFailed(owner, error); warn(error); }
  };
  const currentSession = (): string | undefined => ctx?.sessionManager.getSessionId();
  const verifier = createVerifierTool(publishWorkerCompletion, { ownerSessionId: currentSession,
    ownerGoal: guard.workerOwner, started: guard.workerStarted,
    observe: (runInfo, cancel) => {
      try {
        const observer = registerVerifier(hub, history, runInfo, ctx?.cwd ?? runInfo.cwd, cancel);
        return {
          command: command => { try { observer.command(command); } catch (error) { warn(error); } },
          output: chunk => { try { observer.output(chunk); } catch (error) { warn(error); } },
          finish: (status, outcome) => { try { observer.finish(status === "passed" ? "completed" : status === "cancelled" ? "aborted" : "failed", outcome); } catch (error) { warn(error); } },
        };
      } catch (error) { warn(error); return undefined; }
    },
  });
  pi.registerTool(verifier.tool);
  pi.registerTool(asyncExploreTool(run, publishWorkerCompletion, undefined, undefined, {}, currentSession,
    guard.workerOwner, guard.workerStarted));
  pi.on("tool_call", event => {
    if (explorerOnlyTools.has(event.toolName)) return { block: true, reason: `Delegate ${event.toolName} to one or more narrowly scoped explore calls.` };
    return undefined;
  });
  pi.on("tool_result", event => {
    if (!event.isError && event.toolName === "goal_control" && event.input?.["action"] === "resume") setPhase(guard.currentSkill());
  });
  const stopForSessionChange = (): void => {
    // Workers own disposable read-only snapshots. Request cancellation without
    // making session navigation depend on an unresponsive child or its cleanup.
    verifier.cancelAll();
    void run.stopAll().catch(warn);
  };
  pi.on("session_before_switch", stopForSessionChange);
  pi.on("session_before_fork", stopForSessionChange);
  pi.on("session_before_tree", stopForSessionChange);
  pi.on("input", async (event, nextCtx) => {
    const match = /^\/skill:dev-(spec|build|review|ship)(?:\s|$)/.exec(event.text);
    if (!match?.[1]) return { action: "continue" };
    const next = match[1] as PublicPhase;
    if (next === "ship") {
      nextCtx?.ui.notify("dev-ship runs through /dev-ship so the runtime can isolate and guard the packaging workspace.", "warning");
      return { action: "handled" };
    }
    if (event.source !== "extension" && nextCtx?.sessionManager) {
      const request = event.text.slice(match[0].length).trim();
      if (!request) { nextCtx.ui.notify(`Provide a request: /skill:dev-${next} <request>`, "warning"); return { action: "handled" }; }
      if (!await guard.activate(request, next, nextCtx)) return { action: "handled" }; // Do not execute an unauthorized replacement.
    }
    setPhase(next);
    return { action: "continue" };
  });

  for (const commandPhase of ["spec", "build", "review", "ship"] as const) pi.registerCommand(`dev-${commandPhase}`, {
    description: `Invoke dev-${commandPhase} in the current conversation`,
    handler: async (args, nextCtx) => {
      ctx = nextCtx;
      if (commandPhase === "ship") {
        if (guard.currentSkill()) { nextCtx.ui.notify("Finish or abandon the active goal before dev-ship.", "warning"); return; }
        hubUI.setContext(nextCtx);
        try {
          const result = await (dependencies.packageReviewedCandidate || packageReviewedCandidate)({ cwd: nextCtx.cwd, run, ...(args.trim() ? { name: args.trim() } : {}) });
          pi.sendMessage({ customType: "dev-ship-result", content: result, display: true }, { triggerTurn: false });
        } catch (error) {
          nextCtx.ui.notify(`dev-ship: ${error instanceof Error ? error.message : String(error)}`, "warning");
        }
        return;
      }
      if (!args.trim()) { nextCtx.ui.notify(`Provide a request: /dev-${commandPhase} <request>`, "warning"); return; }
      if (!await guard.activate(args.trim(), commandPhase, nextCtx)) return;
      setPhase(commandPhase);
      hubUI.setContext(nextCtx);
      pi.sendUserMessage(`/skill:dev-${commandPhase}${args ? ` ${args}` : ""}`, { expandPromptTemplates: true });
    },
  });
  pi.registerCommand("dev-goal", {
    description: "Inspect or control the current goal: start <request>, pause, resume, abandon",
    handler: async (args, nextCtx) => {
      const [action, ...rest] = args.trim().split(/\s+/);
      if (action === "start") {
        const request = rest.join(" ") || (nextCtx.hasUI ? await nextCtx.ui.input("Goal request") : undefined);
        if (!request) { nextCtx.ui.notify("Provide a goal request: /dev-goal start <request>", "warning"); return; }
        setPhase(undefined);
        if (await guard.activate(request, undefined, nextCtx, true)) pi.sendUserMessage(request);
        return;
      }
      if (action === "pause") guard.pause();
      else if (action === "resume") { guard.resume(nextCtx); setPhase(guard.currentSkill()); }
      else if (action === "abandon") guard.abandon();
      else if (action && action !== "show") { nextCtx.ui.notify("Use /dev-goal [start <request>|pause|resume|abandon]", "warning"); return; }
      guard.show(nextCtx);
    },
  });
  pi.on("session_shutdown", async () => {
    guard.shutdown(); closing = true; lifetime.abort(); verifier.cancelAll();
    await run.stopAll(); hub.flush(); hubUI.dispose(); hub.dispose();
  });
}
