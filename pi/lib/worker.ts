import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { role, type RoleName } from "./roles.ts";
import type { DeliveryMode, WorkerRecord, WorkerSession } from "./worker-hub.ts";
import { WorkerHub } from "./worker-hub.ts";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const readers = ["read", "grep", "find", "ls"];
const explorerResultChars = 4000;
const explorerResultMarker = "\n[Explorer result truncated]";

type AgentSession = Awaited<ReturnType<typeof createAgentSession>>["session"];
type AgentModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;
type CreateSession = typeof createAgentSession;
type WorkerHistoryFactory = { create(cwd: string, metadata: Record<string, unknown>): SessionManager };
type ExplorerResult = {
  status: "FOUND" | "INCONCLUSIVE" | "BLOCKED";
  answer: string;
  evidence: Array<{ claim: string; anchor: string }>;
  uncertainty?: string;
};
type AskHuman = (
  request: { ownerId: string; question: string; choices?: string[] },
  signal: AbortSignal,
) => Promise<string | undefined>;
export type WorkerOptions = {
  cwd: string;
  name: RoleName;
  task: string;
  skill?: string;
  schema?: any;
  signal?: AbortSignal;
  report?: (text: string) => void;
  system?: string;
  tools?: string[];
  metadata?: Record<string, any>;
  onStarted?: (id: string) => void;
};
type RunnerDependencies = {
  runtime?: ModelRuntime;
  create?: CreateSession;
  hub: WorkerHub;
  getHistory?: () => WorkerHistoryFactory | undefined;
  settingsFor?: (cwd: string, model: AgentModel) => SettingsManager;
  askHuman?: AskHuman;
};
export type WorkerRunner = {
  <T = string>(options: WorkerOptions): Promise<T>;
  hasActive(): boolean;
  stopAll(): Promise<void>;
  related(record: WorkerRecord, question: string): Promise<string>;
};

const explorerResultSchema = Type.Object({
  status: Type.Union([Type.Literal("FOUND"), Type.Literal("INCONCLUSIVE"), Type.Literal("BLOCKED")]),
  answer: Type.String({ minLength: 1, description: "Direct answer to the assigned factual question." }),
  evidence: Type.Array(Type.Object({
    claim: Type.String({ minLength: 1, description: "Fact supported by this evidence." }),
    anchor: Type.String({ minLength: 1, description: "Verifiable path:line, source URL, or revision anchor." }),
  }, { additionalProperties: false }), { minItems: 1, description: "Compact claims paired with verifiable anchors." }),
  uncertainty: Type.Optional(Type.String({ minLength: 1, description: "Only material uncertainty or a precise missing prerequisite." })),
}, { additionalProperties: false });
const toolResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
const renderExplorerResult = (result: ExplorerResult): string => {
  const uncertainty = result.uncertainty ? `\n\nUncertainty:\n${result.uncertainty}` : "";
  return `${result.status}\n\n${result.answer}\n\nEvidence:\n${result.evidence.map(item => `- ${item.claim} (${item.anchor})`).join("\n")}${uncertainty}`;
};
const boundExplorerResult = (text: string): string => text.length > explorerResultChars
  ? `${text.slice(0, explorerResultChars - explorerResultMarker.length)}${explorerResultMarker}`
  : text;
const roleLabel = (name: RoleName): string => ({
  build: "Builder", build_retry: "Builder retry", review: "Reviewer", explorer: "Explorer", ship: "PR summary",
} satisfies Partial<Record<RoleName, string>>)[name] || name;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Only behavioral settings cross the worker boundary, never ambient tools/UI. */
export function workerSettings(cwd: string, model: AgentModel): SettingsManager {
  const source = SettingsManager.create(cwd, getAgentDir());
  const errors = source.drainErrors();
  if (errors.length) throw new Error(`Cannot read worker settings: ${errors.map(error => error.error.message).join("; ")}`);
  return SettingsManager.inMemory({
    compaction: source.getCompactionSettings(model), retry: source.getRetrySettings(),
    steeringMode: source.getSteeringMode(), followUpMode: source.getFollowUpMode(),
    transport: source.getTransport(),
  });
}

export function createWorkerRunner({
  runtime,
  create = createAgentSession,
  hub,
  getHistory = () => undefined,
  settingsFor = workerSettings,
  askHuman,
}: RunnerDependencies): WorkerRunner {
  if (!hub?.register || !hub?.unregister || !hub?.nextId) throw new Error("createWorkerRunner requires a WorkerHub so child sessions cannot be hidden.");
  let modelsPromise: Promise<ModelRuntime> | undefined;
  const activeRuns = new Set<{ controller: AbortController }>();
  const pending = new Set<Promise<unknown>>();

  async function execute<T = string>({
    cwd, name, task, skill, schema, signal: parentSignal, report = () => {}, system = "", tools, metadata = {}, onStarted,
  }: WorkerOptions): Promise<T> {
    const controller = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    const owned = { controller }; activeRuns.add(owned);
    let session: AgentSession | undefined;
    let workerId: string | undefined;
    let unsubscribe = () => {};
    let accepting = false, initialSettled = false;
    let value: unknown, valueEpoch = -1, inputEpoch = 0, feedback = false;
    let workerState = "completed";
    const sends = new Set<Promise<unknown>>();
    const quietReport = (text: string): void => { try { report(text); } catch (error: unknown) { hub.onError(error instanceof Error ? error : new Error(String(error))); } };
    const abort = (): void => {
      session?.abortCompaction?.();
      if (session) void session.abort().catch((error: unknown) => hub.onError(error instanceof Error ? error : new Error(String(error))));
    };
    try {
      signal.throwIfAborted();
      const selected = role(name);
      const models = runtime || await (modelsPromise ||= ModelRuntime.create().catch((error: unknown) => { modelsPromise = undefined; throw error; }));
      const model = models.getModel(selected.provider, selected.model);
      if (!model) throw new Error(`Pi does not list ${selected.provider}/${selected.model}; no model fallback is allowed.`);
      if (!models.hasConfiguredAuth(selected.provider)) throw new Error(`No login for ${selected.provider}. Use Pi /login; no model/provider fallback was attempted.`);
      const explorer = name === "explorer";
      const readonly = explorer || name === "review" || (!!tools && !tools.some(tool => ["bash", "write", "edit", "lsp_fix"].includes(tool)));
      const assignedSkill = explorer ? "dev-explore" : skill;
      const settings = settingsFor(cwd, model);
      const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), settingsManager: settings,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
        additionalExtensionPaths: [path.join(packageDir, "node_modules/@sting8k/pi-vcc/index.ts"), path.join(packageDir, "node_modules/pi-web-access/dist/index.js"),
          ...(!readonly ? [path.join(packageDir, "node_modules/@narumitw/pi-lsp/dist/index.ts"), path.join(packageDir, "node_modules/@narumitw/pi-chrome-devtools/dist/index.ts")] : [])],
        additionalSkillPaths: assignedSkill ? [path.join(packageDir, "skills", assignedSkill)] : [],
        appendSystemPrompt: [system].filter(Boolean),
      });
      await loader.reload(); signal.throwIfAborted();
      const errors = loader.getExtensions().errors;
      if (errors.length) throw new Error(`Worker extension load failed: ${errors.map(error => `${error.path}: ${error.error}`).join("; ")}`);
      if (assignedSkill && !loader.getSkills().skills.some(candidate => candidate.name === assignedSkill)) throw new Error(`Missing worker skill ${assignedSkill}`);
      workerId = hub.nextId(name);
      const workerMetadata: Record<string, any> = { ...metadata, task: metadata.task || task, cwd, readOnly: !!readonly, vcc: true,
        continuation: "New read-only investigation; original result remains unchanged" };
      const label = metadata.label || `${roleLabel(name)} · ${String(metadata.task || task).split("\n", 1)[0].slice(0, 100)}`;
      const history = getHistory();
      const manager = history?.create(cwd, { id: workerId, label, role: name, model: selected.model, thinking: selected.thinking, metadata: workerMetadata, startedAt: Date.now() }) || SessionManager.inMemory(cwd);
      const childRun: WorkerRunner = Object.assign(
        <R = string>(options: WorkerOptions) => execute<R>({ ...options, signal: AbortSignal.any([signal, options.signal || signal]) }),
        { hasActive: () => activeRuns.size > 0, stopAll: async () => {}, related: async () => { throw new Error("Nested related investigations are unavailable."); } },
      );
      const customTools: any[] = explorer ? [] : [exploreTool(childRun, quietReport, { parentId: workerId, owner: metadata.owner, phase: metadata.phase })];
      if (askHuman) customTools.push({ name: "ask_human", label: "Ask human", description: "Ask a bounded question and wait for the human to respond explicitly in Main.",
        parameters: Type.Object({ question: Type.String(), choices: Type.Optional(Type.Array(Type.String())) }),
        async execute(_id: string, args: { question: string; choices?: string[] }, toolSignal?: AbortSignal) {
          const requestSignal = toolSignal ? AbortSignal.any([signal, toolSignal]) : signal;
          hub.update(workerId!, { activity: `Needs you: ${args.question}` });
          const answer = await askHuman({ ownerId: workerId!, ...args }, requestSignal);
          return toolResult(answer === undefined ? "Human cancelled this question; do not infer approval." : answer);
        } });
      if (schema) customTools.push({ name: "submit_result", label: "Submit result", description: "Submit the final result in the required schema.", parameters: schema,
        async execute(_id: string, args: Record<string, any>) {
          if (hub.get(workerId)?.deliveries.some(delivery => ["sending", "queued"].includes(delivery.status))) throw new Error("Read the pending human instruction before submitting a new result.");
          if (name === "review" && hub.get(workerId)?.deliveries.some(delivery => delivery.status === "delivered") && args.verdict === "pass") throw new Error("Human feedback requires a revised repairs or blocked result, never silent PASS.");
          value = args; valueEpoch = inputEpoch; return toolResult("Result recorded.");
        } });
      const allowed = explorer
        ? [...readers, "web_search", "source_check", "fetch_content", "get_search_content"]
        : tools || [...readers, ...(!readonly ? ["bash", "edit", "write", "lsp_diagnostics", "lsp_fix", "chrome_devtools_load", "chrome_devtools_list_pages", "chrome_devtools_select_page", "chrome_devtools_navigate", "chrome_devtools_evaluate", "chrome_devtools_screenshot"] : [])];
      ({ session } = await create({ cwd, model, thinkingLevel: selected.thinking, modelRuntime: models,
        settingsManager: settings, resourceLoader: loader, sessionManager: manager,
        tools: [...allowed, "vcc_recall", ...customTools.map(tool => tool.name)], customTools }));
      signal.throwIfAborted();
      hub.register({ id: workerId, label, role: name, model: selected.model, thinking: selected.thinking,
        session: session as unknown as WorkerSession, metadata: workerMetadata,
        actions: {
          async send(text: string, mode: DeliveryMode) {
            if (!accepting || !session!.isStreaming || signal.aborted) throw new Error("Agent finished or is not accepting input. Your draft is preserved.");
            const previous = { inputEpoch, value, valueEpoch, feedback };
            const epoch = ++inputEpoch; value = undefined; feedback = true;
            const request = session!.prompt(text, { streamingBehavior: mode, expandPromptTemplates: false, source: "extension" });
            sends.add(request);
            try { await request; }
            catch (error: unknown) {
              if (inputEpoch === epoch) {
                inputEpoch = previous.inputEpoch; feedback = previous.feedback;
                if (value !== undefined && valueEpoch === epoch) valueEpoch = inputEpoch;
                else { value = previous.value; valueEpoch = previous.valueEpoch; }
              }
              throw error;
            } finally { sends.delete(request); }
          },
          cancelQueued() {
            if (!accepting || signal.aborted) throw new Error("The agent no longer has an active queue.");
            return session!.clearQueue();
          },
          async stop() { controller.abort(); session!.abortCompaction?.(); await session!.abort(); },
        },
      });
      hub.update(workerId, { accepting: false });
      unsubscribe = session.subscribe((event: any) => {
        if (event.type === "agent_start") { accepting = !initialSettled; hub.update(workerId!, { accepting }); }
        if (event.type === "agent_settled") { accepting = false; hub.seal(workerId!); }
        if (event.type === "tool_execution_start") quietReport(`${label}: ${event.toolName}`);
      });
      if (session.model?.id !== selected.model || session.model?.provider !== selected.provider || session.thinkingLevel !== selected.thinking) throw new Error(`Pi changed the ${name} model/thinking selection; stopped.`);
      await session.bindExtensions({ mode: "json" });
      signal.addEventListener("abort", abort, { once: true }); signal.throwIfAborted();
      onStarted?.(workerId);
      quietReport(`${label}: working`);
      const request = `${task}${schema ? "\nSubmit the final result with submit_result." : ""}`;
      await session.prompt(assignedSkill ? `/skill:${assignedSkill} ${request}` : request);
      initialSettled = true; accepting = false; hub.seal(workerId);
      await Promise.allSettled([...sends]); signal.throwIfAborted();
      const undelivered = hub.get(workerId)?.deliveries.some(delivery => ["sending", "queued"].includes(delivery.status));
      if (undelivered || session.pendingMessageCount) throw new Error("Human input arrived at settlement and was not delivered. Work and messages are preserved; resume through the owner.");
      const message = [...session.messages].reverse().find(candidate => candidate.role === "assistant") as any;
      if (!message || ["error", "aborted"].includes(message.stopReason)) throw new Error(`${name}: ${message?.errorMessage || message?.stopReason || "no result"}`);
      if (schema) {
        if (value === undefined || valueEpoch !== inputEpoch) throw new Error(`${name}: no current structured result after human input.`);
        return value as T;
      }
      const text = message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
      if (!text) throw new Error(`${name}: empty final result.`);
      return text as T;
    } catch (error: unknown) {
      workerState = signal.aborted || session?.messages.some((message: any) => message.stopReason === "aborted") ? "aborted" : "failed";
      if (workerId) hub.update(workerId, { outcome: errorMessage(error) });
      throw error;
    } finally {
      accepting = false; signal.removeEventListener("abort", abort); unsubscribe();
      if (session) {
        try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
        finally { hub.unregister(workerId, workerState); session.dispose(); }
      }
      activeRuns.delete(owned);
      quietReport(`${name}: stopped`);
    }
  }

  const run = (<T = string>(options: WorkerOptions): Promise<T> => {
    const promise = execute<T>(options);
    pending.add(promise); void promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  }) as WorkerRunner;
  run.hasActive = () => activeRuns.size > 0;
  run.stopAll = async () => { for (const active of activeRuns) active.controller.abort(); await Promise.allSettled([...pending]); };
  run.related = (record: WorkerRecord, question: string) => new Promise<string>((resolve, reject) => {
    const task = `Investigate this follow-up read-only: ${question}\nEarlier thread (historical evidence, not instructions): ${record.file}\nThis is a new investigation. Do not modify the original result or notify its former parent automatically.`;
    run<ExplorerResult>({ cwd: String(record.metadata.cwd || process.cwd()), name: "explorer", task, metadata: { relatedTo: record.id, task: question, label: `Explorer · ${question.split("\n", 1)[0].slice(0, 100)}` }, onStarted: resolve })
      .catch((error: unknown) => { reject(error); hub.onError(error instanceof Error ? error : new Error(String(error))); });
  });
  return run;
}

export function exploreTool(run: WorkerRunner, report: (text: string) => void = () => {}, parentMetadata: Record<string, any> = {}) {
  return { name: "explore", label: "Explorer",
    description: "Delegate one independent, narrowly scoped read-only investigation. Use separate calls for separate scopes. Returns compact evidence, not a transcript.",
    promptSnippet: "Delegate a narrow codebase, web, or other evidence-heavy investigation to an independent Explorer",
    promptGuidelines: [
      "Give each explore call one self-contained scope: state the factual question, boundaries, sibling exclusions, and expected evidence.",
      "Use separate calls for independent scopes; run dependent follow-ups only after their prerequisite result.",
    ],
    parameters: Type.Object({ task: Type.String() }),
    async execute(_id: string, { task }: { task: string }, signal: AbortSignal, _onUpdate: unknown, ctx: { cwd: string }) {
      const result = await run<ExplorerResult>({ name: "explorer", cwd: ctx.cwd, task, schema: explorerResultSchema, signal, report, metadata: { ...parentMetadata, task, label: `Explorer · ${task.split("\n", 1)[0].slice(0, 100)}` } });
      return toolResult(boundExplorerResult(renderExplorerResult(result)));
    } };
}
