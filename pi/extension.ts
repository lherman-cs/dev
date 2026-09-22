import { safeText } from "./lib/worker-transcript.ts";
import { humanEditor } from "./lib/human-editor.ts";
import { Text } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import type { ExtensionAPI, ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { createWorkerRunner, exploreTool } from "./lib/worker.ts";
import type { RoleName } from "./lib/roles.ts";
import { WorkerHub, isActive } from "./lib/worker-hub.ts";
import { WorkerHistory } from "./lib/worker-history.ts";
import { WorkflowControl, WorkflowPaused } from "./lib/workflow-control.ts";
import { registerWorkerHubUI } from "./worker-hub-ui.ts";
import { errorMessage, runWorkflow, excludeState } from "./lib/workflow.ts";
import type { WorkerHistory as WorkerHistoryStore } from "./lib/worker-history.ts";
import type { RegisterWorker, WorkerPatch, WorkerRecord, WorkerState } from "./lib/worker-types.ts";
import type { DelegateOptions, RepairIssue, ReviewChoice, WorkflowHarness, WorkflowPhase } from "./lib/workflow-types.ts";

export const explorerOnlyTools = new Set(["web_search", "source_check", "fetch_content", "get_search_content"]);
const mainReaders = new Set(["read", "grep", "find", "ls", "explore", "vcc_recall", "ask_user_question"]);
export const workflowError = (error: unknown, phase: WorkflowPhase, target = ""): string => `${errorMessage(error)}\n\nProgress is preserved. After resolving the issue, resume with /dev-${phase}${target ? ` ${target}` : ""}.`;

type HubUI = ReturnType<typeof registerWorkerHubUI>;
type WorkerRunner = ReturnType<typeof createWorkerRunner>;
interface ExtensionDependencies {
  hub?: WorkerHub;
  createWorkerRunner?: typeof createWorkerRunner;
  registerWorkerHubUI?: typeof registerWorkerHubUI;
  runWorkflow?: typeof runWorkflow;
}
interface AuditData { phase?: string; text?: string; command?: string; code?: number; stdout?: string; stderr?: string; error?: string }
interface ExternalWorkerRequest {
  sessionId: string;
  receive(adapter: {
    createSessionManager(cwd: string, metadata: Record<string, unknown>): SessionManager;
    register(record: RegisterWorker): { update(patch: WorkerPatch): void; finish(state?: WorkerState): void };
  }): void;
}
const isExternalWorkerRequest = (value: unknown): value is ExternalWorkerRequest => !!value && typeof value === "object" && typeof (value as Partial<ExternalWorkerRequest>).sessionId === "string" && typeof (value as Partial<ExternalWorkerRequest>).receive === "function";

// Optional constructors keep integration tests on the same registration path.
export default function extension(pi: ExtensionAPI, dependencies: ExtensionDependencies = {}): void {
  let ctx: ExtensionContext | undefined, history: WorkerHistoryStore | undefined;
  let active: WorkflowControl | undefined, lastControl: WorkflowControl | undefined;
  let foregroundPrompts = 0, closing = false;
  const lifetime = new AbortController();
  const warn = (error: unknown): void => { if (!closing) ctx?.ui.notify(`Agent Hub: ${errorMessage(error)}`, "warning"); };
  const hub = dependencies.hub || new WorkerHub({ onError: warn });
  const run = (dependencies.createWorkerRunner || createWorkerRunner)({ hub, getHistory: () => history,
    askHuman: ({ ownerId, question, choices }: { ownerId: string; question: string; choices?: string[] }, signal?: AbortSignal) => hub.request<string | undefined, ExtensionContext>({ ownerId, title: question, run: async (context: ExtensionContext) => {
      if (!context.hasUI) throw new Error("Human response requires interactive Pi.");
      return choices?.length ? context.ui.select(question, ["Cancel", ...choices], signal ? { signal } : {}).then(value => value === "Cancel" ? undefined : value) : humanEditor(context, question, "", signal);
    } }, signal),
  });
  hub.onRelated = (record, text) => run.related(record, text);
  const control = (): WorkflowControl | undefined => active || lastControl;
  const writesOwned = (): boolean => !!active || hub.list().some(r => isActive(r) && !r.metadata["readOnly"]);
  const ownershipMessage = "Main is read-only while a controller or writing child owns this worktree. Alt+A opens that agent. /dev-pause stops before the next safe step; /dev-stop cancels running work. Wait for Paused/Stopped before editing in Main.";
  let hubUI: HubUI;
  const respond = async (questionId?: string): Promise<void> => {
    if (!active?.pending && !hub.questions().length) return;
    await hubUI.beforePrompt();
    if (!ctx || foregroundPrompts > 0) {
      ctx?.ui.notify("Finish the current human dialog before responding. The decision remains pending.", "warning"); return;
    }
    // A synchronous Main -> Explorer call can be waiting on this very question.
    // Explicit claiming is safe while Main streams; requiring idle deadlocks it.
    if (questionId) return hub.questions().find(q => q.id === questionId)?.answer(ctx);
    if (active?.pending) return active.pending.respond();
    const questions = hub.questions();
    const choices = questions.map(q => `${hub.get(q.ownerId)?.label || "Agent"} · ${q.title}`);
    const selected = await ctx.ui.select("Choose a question to answer", ["Cancel", ...choices]);
    const index = selected ? choices.indexOf(selected) : -1;
    const question = index >= 0 ? questions[index] : undefined;
    if (question) await question.answer(ctx);
  };
  hubUI = (dependencies.registerWorkerHubUI || registerWorkerHubUI)(pi, hub, {
    control, respond,
    resume: () => continueWorkflow(),
  });
  const audit = (kind: string, data: AuditData): void => {
    if (!closing) try { pi.appendEntry?.("dev-controller-event", { kind, at: Date.now(), ...data }); } catch (error) { warn(error); }
  };
  pi.registerEntryRenderer?.("dev-controller-event", (entry, _opts, theme) => {
    const data = entry.data && typeof entry.data === "object" ? entry.data as AuditData & { kind?: string } : {};
    return new Text(theme.fg(data.code || data.error ? "error" : "muted", safeText(`${data.phase || "Workflow"} · ${data.kind || "event"}\n${data.text || data.command || ""}${data.stdout ? `\nstdout:\n${data.stdout}` : ""}${data.stderr ? `\nstderr:\n${data.stderr}` : ""}${data.error ? `\n${data.error}` : ""}`)), 0, 0);
  });

  pi.on("session_start", async (_event, nextCtx) => {
    ctx = nextCtx;
    history = new WorkerHistory(ctx.sessionManager as unknown as ConstructorParameters<typeof WorkerHistory>[0], message => warn(message));
    hub.setHistory(history); hubUI.setContext(ctx); hubUI.setWorkflow();
    await history.restore(hub, lifetime.signal);
  });
  // Other extensions may register externally-owned native sessions. The small
  // adapter is parent-scoped, not global discovery or a new spawning tool.
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
        return {
          update(patch: WorkerPatch) { valid(); hub.update(record.id, patch); },
          finish(state: WorkerState = "completed") { valid(); hub.unregister(record.id, state); },
        };
      },
    });
  });

  pi.registerTool(exploreTool(run));
  pi.on("tool_call", event => {
    if (explorerOnlyTools.has(event.toolName)) return { block: true, reason: `Delegate ${event.toolName} to one or more narrowly scoped explore calls.` };
    if (writesOwned() && !mainReaders.has(event.toolName)) return { block: true, reason: ownershipMessage };
    return undefined;
  });
  pi.on("user_bash", () => writesOwned() ? { result: { output: ownershipMessage, exitCode: 1, cancelled: false, truncated: false } } : undefined);
  // Do not open a controller behind a main-turn tool/question dialog.
  pi.on("ui_prompt_start", () => { foregroundPrompts++; });
  pi.on("ui_prompt_end", () => { foregroundPrompts = Math.max(0, foregroundPrompts - 1); });
  const preventSessionChange = (): { cancel: true } | undefined => {
    if (active || run.hasActive() || hub.list().some(isActive)) {
      ctx?.ui.notify("Stop active work before changing the parent session. Histories and drafts will be preserved.", "warning");
      return { cancel: true };
    }
    return undefined;
  };
  pi.on("session_before_switch", preventSessionChange);
  pi.on("session_before_fork", preventSessionChange);

  for (const phase of ["spec", "plan"]) pi.registerCommand(`dev-${phase}`, {
    description: `Invoke dev-${phase} in the current conversation`,
    handler: async (args, nextCtx) => {
      ctx = nextCtx;
      if (writesOwned()) { nextCtx.ui.notify(ownershipMessage, "warning"); return; }
      hubUI.setContext(nextCtx); hubUI.setWorkflow(`dev-${phase}`);
      try {
        await excludeState({ cwd: nextCtx.cwd, exec: (program, argv) => pi.exec(program, argv, { cwd: nextCtx.cwd }) });
        pi.sendUserMessage(`/skill:dev-${phase}${args ? ` ${args}` : ""}`, { expandPromptTemplates: true });
      } catch (error: unknown) { nextCtx.ui.notify(errorMessage(error), "error"); }
    },
  });

  async function continueWorkflow() {
    if (active || !lastControl || !ctx) return;
    try {
      await lastControl.verifyResume();
      if (!lastControl.phase) throw new Error("Paused workflow has no phase.");
      await start(lastControl.phase, lastControl.target, ctx);
    } catch (error: unknown) { ctx.ui.notify(errorMessage(error), "warning"); }
  }

  async function start(phase: WorkflowPhase, args: string, nextCtx: ExtensionContext): Promise<void> {
    ctx = nextCtx;
    const context = nextCtx;
    if (active || !context.isIdle() || context.hasPendingMessages?.() || foregroundPrompts > 0 || hub.list().some(r => isActive(r) && !r.metadata["readOnly"])) {
      context.ui.notify("Finish or stop active writing work and Main's turn before starting another controller.", "warning"); return;
    }
    try { history?.ensureParent(); } catch (error: unknown) { context.ui.notify(`Cannot persist the parent session: ${errorMessage(error)}`, "error"); return; }
    const current = new WorkflowControl(phase, args, () => hubUI.refresh());
    active = current; lastControl = current;
    hubUI.setContext(context); hubUI.setWorkflow(`dev-${phase}`);
    const report = (text: string): void => { current.update(text); audit("progress", { phase, text }); };
    const ask = <T>(title: string, show: () => Promise<T>): Promise<T> => {
      if (!context.hasUI) return Promise.reject(new Error("Human approval requires interactive Pi."));
      audit("needs human", { phase, text: title });
      return current.ask(title, show);
    };
    const h: WorkflowHarness = {
      cwd: context.cwd, signal: current.signal, control: current,
      rawExec(program: string, argv: string[]) { return pi.exec(program, argv, { cwd: this.cwd }); },
      checkpoint: (activity?: string) => current.checkpoint(activity),
      async exec(program: string, argv: string[]) {
        current.signal.throwIfAborted();
        const command = `${program} ${argv.join(" ")}`;
        audit("command start", { phase, command });
        try {
          const result = await pi.exec(program, argv, { cwd: this.cwd, signal: current.signal });
          audit("command end", { phase, command, code: result.code, stdout: result.stdout, stderr: result.stderr });
          current.signal.throwIfAborted(); return result;
        } catch (error: unknown) {
          audit("command interrupted", { phase, command, error: errorMessage(error) });
          throw error;
        }
      },
      async delegate(name: string, task: string, skill?: string, schema?: unknown, options: DelegateOptions = {}): Promise<unknown> {
        current.checkpoint();
        const { metadata = {}, ...rest } = options;
        let id: string | undefined;
        const result = await run({ cwd: this.cwd, name: name as RoleName, task, ...(skill === undefined ? {} : { skill }), ...(schema === undefined ? {} : { schema: schema as TSchema }), ...rest,
          signal: current.signal, metadata: { phase, owner: "workflow", ...metadata },
          onStarted: (value: string) => { id = value; }, report: (text: string) => current.update(text),
        });
        if (id) this.lastWorkerId = id;
        return result;
      },
      workerOutcome: (id: string | undefined, outcome: string) => { if (id) hub.update(id, { outcome }); },
      select: (title: string, choices: string[]) => ask(title, () => context.ui.select(title, ["Cancel", ...choices], { signal: current.signal }).then(v => v === "Cancel" ? undefined : v)),
      confirm: (title: string, message: string) => ask(title, async () => (await context.ui.select(`${title}\n${message}`, ["Cancel", "Confirm"], { signal: current.signal })) === "Confirm"),
      review: (title: string, markdown: string, repairs?: readonly RepairIssue[]): Promise<ReviewChoice> => ask(title, async () => {
        pi.sendMessage({ customType: "dev-workflow", content: markdown, display: true }, { triggerTurn: false });
        if (repairs) {
          pi.sendMessage({ customType: "dev-workflow", content: repairs.map(r => `## ${r.title}\n${r.reason}\n\n${r.goal}\n\n${(r.evidence || []).join("\n")}\n\nChecks: ${(r.checks || []).join(", ")}`).join("\n\n"), display: true }, { triggerTurn: false });
          const chosen = new Set<string>();
          while (true) {
            const labels = repairs.map((r, i) => `${i + 1}. ${chosen.has(r.key) ? "[x]" : "[ ]"} ${r.title}`);
            const selected = await context.ui.select(title, ["Cancel", ...labels, "Apply selected"], { signal: current.signal });
            current.signal.throwIfAborted();
            if (selected === "Apply selected") return { keys: [...chosen] };
            if (!selected || selected === "Cancel") return { action: "cancel" };
            const issue = repairs[labels.indexOf(selected)];
            if (!issue) throw new Error("Selected repair no longer exists.");
            const key = issue.key;
            chosen.has(key) ? chosen.delete(key) : chosen.add(key);
          }
        }
        const action = await context.ui.select(title, ["Cancel", "Request changes", "Approve exact candidate"], { signal: current.signal });
        current.signal.throwIfAborted();
        if (action === "Approve exact candidate") return { action: "approve" };
        if (action === "Request changes") {
          const feedback = await humanEditor(context, "Review feedback", "", current.signal);
          if (feedback?.trim()) return { action: "feedback", feedback };
        }
        return { action: "cancel" };
      }),
      report,
    };
    let failure: unknown;
    try { await (dependencies.runWorkflow || runWorkflow)(h, phase, args); }
    catch (error: unknown) { failure = error; if (!closing) context.ui.notify(workflowError(error, phase, args), current.signal.aborted ? "info" : "warning"); }
    finally {
      if (failure instanceof WorkflowPaused) {
        try { await current.capturePause(); }
        catch (error: unknown) { warn(`Pause state preserved but fast continuation disabled: ${errorMessage(error)}`); }
      }
      current.finish(failure); audit(current.state, { phase, text: `${current.activity}\n${current.resumeCommand}` });
      if (active === current) active = undefined;
      hubUI.refresh();
    }
  }
  for (const phase of ["build", "prepare", "review", "ship"] as const satisfies readonly WorkflowPhase[]) pi.registerCommand(`dev-${phase}`, {
    description: `Run ${phase} for an approved project or spec path`, handler: (args, nextCtx) => start(phase, args, nextCtx),
  });
  pi.registerCommand("dev-continue", { description: "Continue a safely paused workflow only if repository and contracts are unchanged", handler: async (_args, nextCtx) => { ctx = nextCtx; await continueWorkflow(); } });
  pi.registerCommand("dev-pause", { description: "Pause the controller at the next safe boundary; no rollback", handler: async () => {
    if (active) { active.pause(); audit("pause requested", { phase: active.phase }); }
    else ctx?.ui.notify("No active controller. Use Alt+A to stop a specific agent.", "info");
  } });
  pi.registerCommand("dev-respond", { description: "Explicitly open the pending human decision in Main", handler: async (_args, nextCtx) => { ctx = nextCtx; await respond(_args.trim() || undefined); } });
  pi.registerCommand("dev-stop", { description: "Cancel the controller and all child agents; preserve partial work", handler: async () => {
    active?.stop();
    await Promise.allSettled(hub.list().filter(isActive).map(r => hub.abort(r.id)));
    await run.stopAll();
  } });
  pi.on("session_shutdown", async () => {
    closing = true; lifetime.abort(); active?.stop();
    await Promise.allSettled(hub.list().filter(isActive).map(r => hub.abort(r.id)));
    await run.stopAll(); hub.flush(); unlisten?.(); hubUI.dispose(); hub.dispose();
  });
}
