import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import { role, type RoleName } from "./roles.ts";
import type { WorkerHistory } from "./worker-history.ts";
import type { WorkerHub } from "./worker-hub.ts";
import type { WorkerRecord, WorkerSession, WorkerState } from "./worker-types.ts";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const readers = ["read", "grep", "find", "ls"];
const explorerResultChars = 4000;
const explorerResultMarker = "\n[Explorer result truncated]";
const reviewResultChars = 12000;
const exploreParameters = Type.Object({ task: Type.String() });
const reviewParameters = Type.Object({
  task: Type.String({ minLength: 1, maxLength: 12000 }),
  candidate: Type.String({ minLength: 1, maxLength: 2000 }),
  evidence: Type.String({ minLength: 1, maxLength: 12000 }),
}, { additionalProperties: false });
const reviewResultSchema = Type.Object({
  verdict: Type.Union([Type.Literal("PASS"), Type.Literal("REPAIRS"), Type.Literal("BLOCKED")]),
  candidate: Type.String({ minLength: 1, maxLength: 2000 }),
  evidence: Type.String({ minLength: 1, maxLength: 12000 }),
  summary: Type.String({ minLength: 1, maxLength: 4000 }),
  findings: Type.Array(Type.Object({
    key: Type.String({ minLength: 1, maxLength: 200 }),
    title: Type.String({ minLength: 1, maxLength: 500 }),
    problem: Type.String({ minLength: 1, maxLength: 4000 }),
    evidence: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { maxItems: 20 }),
    acceptance_checks: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { maxItems: 20 }),
  }, { additionalProperties: false }), { maxItems: 30 }),
  blocker: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
}, { additionalProperties: false });
export type ReviewResult = Static<typeof reviewResultSchema>;
const explorerResultSchema = Type.Object({
  status: Type.Union([Type.Literal("FOUND"), Type.Literal("INCONCLUSIVE"), Type.Literal("BLOCKED")]),
  answer: Type.String({ minLength: 1, description: "Direct answer to the assigned factual question." }),
  evidence: Type.Array(Type.Object({
    claim: Type.String({ minLength: 1, description: "Fact supported by this evidence." }),
    anchor: Type.String({ minLength: 1, description: "Verifiable path:line, source URL, or revision anchor." }),
  }, { additionalProperties: false }), { minItems: 1, description: "Compact claims paired with verifiable anchors." }),
  uncertainty: Type.Optional(Type.String({ minLength: 1, description: "Only material uncertainty or a precise missing prerequisite." })),
}, { additionalProperties: false });
interface ExplorerResult { status: "FOUND" | "INCONCLUSIVE" | "BLOCKED"; answer: string; evidence: Array<{ claim: string; anchor: string }>; uncertainty?: string }
const toolResult = (text: string): { content: [{ type: "text"; text: string }]; details: Record<string, never> } => ({ content: [{ type: "text", text }], details: {} });
const renderExplorerResult = (result: ExplorerResult): string => {
  const uncertainty = result.uncertainty ? `\n\nUncertainty:\n${result.uncertainty}` : "";
  return `${result.status}\n\n${result.answer}\n\nEvidence:\n${result.evidence.map((item: ExplorerResult["evidence"][number]) => `- ${item.claim} (${item.anchor})`).join("\n")}${uncertainty}`;
};
const boundExplorerResult = (text: string): string => text.length > explorerResultChars
  ? `${text.slice(0, explorerResultChars - explorerResultMarker.length)}${explorerResultMarker}`
  : text;
const roleLabels: Partial<Record<RoleName, string>> = { build: "Builder", review: "Reviewer", explorer: "Explorer", ship: "Shipper" };
const roleLabel = (name: RoleName): string => roleLabels[name] ?? name;

/** Only behavioral settings cross the worker boundary, never ambient tools/UI. */
export function workerSettings(cwd: string, model: Parameters<SettingsManager["getCompactionSettings"]>[0]): SettingsManager {
  const source = SettingsManager.create(cwd, getAgentDir());
  const errors = source.drainErrors();
  if (errors.length) throw new Error(`Cannot read worker settings: ${errors.map(e => e.error.message).join("; ")}`);
  return SettingsManager.inMemory({
    compaction: source.getCompactionSettings(model), retry: source.getRetrySettings(),
    steeringMode: source.getSteeringMode(), followUpMode: source.getFollowUpMode(),
    transport: source.getTransport(),
  });
}

interface RunMetadata extends Record<string, unknown> { task?: string; label?: string; owner?: string; phase?: string; cwd?: string }
interface RunArguments<TShape extends TSchema | undefined = undefined> {
  cwd: string;
  name: RoleName;
  task: string;
  skill?: string;
  schema?: TShape;
  signal?: AbortSignal;
  report?: (text: string) => void;
  system?: string;
  tools?: string[];
  metadata?: RunMetadata;
  onStarted?: (workerId: string) => void;
}
type RunResult<TShape extends TSchema | undefined> = TShape extends TSchema ? Static<TShape> : string;
export type RunWorker = <TShape extends TSchema | undefined = undefined>(args: RunArguments<TShape>) => Promise<RunResult<TShape>>;
interface WorkerRunner extends RunWorker {
  hasActive(): boolean;
  stopAll(): Promise<void>;
  related(record: WorkerRecord, question: string): Promise<string>;
}
interface RunnerOptions {
  runtime?: ModelRuntime;
  create?: typeof createAgentSession;
  hub: WorkerHub;
  getHistory?: () => WorkerHistory | undefined;
  settingsFor?: typeof workerSettings;
  askHuman?: (request: { ownerId: string; question: string; choices?: string[] }, signal?: AbortSignal) => Promise<string | undefined>;
}
interface ActiveRun { controller: AbortController }

// The runner owns sessions. Hub actions call back into this owner rather than
// inventing a second lifecycle, routing policy, or model-selection mechanism.
export function createWorkerRunner(options: RunnerOptions): WorkerRunner {
  const { runtime, create = createAgentSession, hub, getHistory = () => undefined, settingsFor = workerSettings, askHuman } = options;
  if (!hub?.register || !hub?.unregister || !hub?.nextId) throw new Error("createWorkerRunner requires a WorkerHub so child sessions cannot be hidden.");
  let modelsPromise: Promise<ModelRuntime> | undefined;
  const activeRuns = new Set<ActiveRun>();
  async function execute<TShape extends TSchema | undefined = undefined>({ cwd, name, task, skill, schema, signal: parentSignal, report = () => undefined, system = "", tools, metadata = {}, onStarted }: RunArguments<TShape>): Promise<RunResult<TShape>> {
    const controller = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    const owned = { controller }; activeRuns.add(owned);
    let session: AgentSession | undefined;
    let workerId: string | undefined;
    let unsubscribe: () => void = () => undefined;
    let accepting = false, initialSettled = false;
    let value: unknown, valueEpoch = -1, inputEpoch = 0, feedback = false;
    let workerState: WorkerState = "completed";
    const sends = new Set<Promise<void>>();
    const quietReport = (text: string): void => { try { report(text); } catch (error) { hub.onError(error instanceof Error ? error : new Error(String(error))); } };
    const abort = () => { session?.abortCompaction?.(); void session?.abort().catch(error => hub.onError(error)); };
    try {
      signal.throwIfAborted();
      const selected = role(name);
      const models = runtime || await (modelsPromise ||= ModelRuntime.create().catch(error => { modelsPromise = undefined; throw error; }));
      const model = models.getModel(selected.provider, selected.model);
      if (!model) throw new Error(`Pi does not list ${selected.provider}/${selected.model}; no model fallback is allowed.`);
      if (!models.hasConfiguredAuth(selected.provider)) throw new Error(`No login for ${selected.provider}. Use Pi /login; no model/provider fallback was attempted.`);
      const explorer = name === "explorer";
      const readonly = explorer || name === "review" || (tools && !tools.some(t => ["bash", "write", "edit", "lsp_fix"].includes(t)));
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
      if (errors.length) throw new Error(`Worker extension load failed: ${errors.map(e => `${e.path}: ${e.error}`).join("; ")}`);
      if (assignedSkill && !loader.getSkills().skills.some(s => s.name === assignedSkill)) throw new Error(`Missing worker skill ${assignedSkill}`);
      const id = hub.nextId(name);
      workerId = id;
      const workerMetadata = { ...metadata, task: metadata.task || task, cwd, readOnly: !!readonly, vcc: true,
        continuation: "New read-only investigation; original result remains unchanged" };
      const label = metadata.label || `${roleLabel(name)} · ${(String(metadata.task || task).split("\n", 1)[0] ?? name).slice(0, 100)}`;
      const history = getHistory();
      const manager = history?.create(cwd, { id, label, role: name, model: selected.model, thinking: selected.thinking, metadata: workerMetadata, startedAt: Date.now() }) || SessionManager.inMemory(cwd);
      const childRun: RunWorker = <TChildShape extends TSchema | undefined = undefined>(args: RunArguments<TChildShape>) => execute({ ...args, signal: AbortSignal.any([signal, args.signal ?? signal]) });
      const customTools: ToolDefinition[] = explorer ? [] : [exploreTool(childRun, quietReport, { parentId: id, owner: metadata.owner, phase: metadata.phase }) as unknown as ToolDefinition];
      if (askHuman && !readonly) {
        const askSchema = Type.Object({ question: Type.String(), choices: Type.Optional(Type.Array(Type.String())) });
        customTools.push({ name: "ask_human", label: "Ask human", description: "Ask a bounded question and wait for the human to respond explicitly in Main.",
        parameters: askSchema,
        async execute(_id: string, args: Static<typeof askSchema>, toolSignal: AbortSignal | undefined) {
          const requestSignal = toolSignal ? AbortSignal.any([signal, toolSignal]) : signal;
          hub.update(id, { activity: `Needs you: ${args.question}` });
          const answer = await askHuman({ ownerId: id, ...args }, requestSignal);
          return toolResult(answer === undefined ? "Human cancelled this question; do not infer approval." : answer);
        } });
      }
      if (schema) customTools.push({ name: "submit_result", label: "Submit result", description: "Submit the final result in the required schema.", parameters: schema,
        async execute(_id: string, args: Static<NonNullable<TShape>>) {
          if (hub.get(id)?.deliveries.some(d => ["sending", "queued"].includes(d.status))) throw new Error("Read the pending human instruction before submitting a new result.");
          if (name === "review" && hub.get(id)?.deliveries.some(d => d.status === "delivered") && args["verdict"] === "pass") throw new Error("Human feedback requires a revised repairs or blocked result, never silent PASS.");
          value = args; valueEpoch = inputEpoch; return toolResult("Result recorded.");
        } });
      const allowed = explorer
        ? [...readers, "web_search", "source_check", "fetch_content", "get_search_content"]
        : name === "review"
          ? readers
          : tools || [...readers, ...(!readonly ? ["bash", "edit", "write", "lsp_diagnostics", "lsp_fix", "chrome_devtools_load", "chrome_devtools_list_pages", "chrome_devtools_select_page", "chrome_devtools_navigate", "chrome_devtools_evaluate", "chrome_devtools_screenshot"] : [])];
      const created = await create({ cwd, model, thinkingLevel: selected.thinking, modelRuntime: models,
        settingsManager: settings, resourceLoader: loader, sessionManager: manager,
        tools: [...allowed, "vcc_recall", ...customTools.map(tool => tool.name)], customTools });
      session = created.session;
      const childSession = created.session;
      signal.throwIfAborted();
      hub.register({ id, label, role: name, model: selected.model, thinking: selected.thinking, session: childSession as unknown as WorkerSession, metadata: workerMetadata,
        actions: {
          async send(text, mode) {
            if (!accepting || !childSession.isStreaming || signal.aborted) throw new Error("Agent finished or is not accepting input. Your draft is preserved.");
            // A new human instruction invalidates any prior structured verdict.
            // Send the human text verbatim; approved-contract semantics live in
            // the assigned skill, not in a generic hub-wide prompt wrapper.
            // Native prompt with expansion disabled queues literal text (including
            // slash-prefixed examples) without executing commands or skills.
            const previous = { inputEpoch, value, valueEpoch, feedback };
            const epoch = ++inputEpoch; value = undefined; feedback = true;
            const pending = childSession.prompt(text, { streamingBehavior: mode, expandPromptTemplates: false, source: "extension" });
            sends.add(pending);
            try { await pending; }
            catch (error) {
              // A rejected queue operation did not change the conversation.
              if (inputEpoch === epoch) {
                inputEpoch = previous.inputEpoch; feedback = previous.feedback;
                if (value !== undefined && valueEpoch === epoch) valueEpoch = inputEpoch;
                else { value = previous.value; valueEpoch = previous.valueEpoch; }
              }
              throw error;
            } finally { sends.delete(pending); }
          },
          cancelQueued() {
            if (!accepting || signal.aborted) throw new Error("The agent no longer has an active queue.");
            return childSession.clearQueue();
          },
          async stop() { controller.abort(); childSession.abortCompaction?.(); await childSession.abort(); },
        },
      });
      hub.update(id, { accepting: false });
      unsubscribe = childSession.subscribe(event => {
        if (event.type === "agent_start") { accepting = !initialSettled; hub.update(id, { accepting }); }
        if (event.type === "agent_settled") { accepting = false; hub.seal(id); }
        if (event.type === "tool_execution_start") quietReport(`${label}: ${event.toolName}`);
      });
      if (childSession.model?.id !== selected.model || childSession.model?.provider !== selected.provider || childSession.thinkingLevel !== selected.thinking) throw new Error(`Pi changed the ${name} model/thinking selection; stopped.`);
      await childSession.bindExtensions({ mode: "json" });
      signal.addEventListener("abort", abort, { once: true }); signal.throwIfAborted();
      onStarted?.(id);
      quietReport(`${label}: working`);
      const request = `${task}${schema ? "\nSubmit the final result with submit_result." : ""}`;
      await childSession.prompt(assignedSkill ? `/skill:${assignedSkill} ${request}` : request);
      initialSettled = true; accepting = false; hub.seal(id);
      // A send accepted during the original turn can finish its native input
      // pipeline after that turn settles. Wait for it; never release a stale
      // result to the parent or reopen acceptance for unrelated late sends.
      await Promise.allSettled([...sends]); signal.throwIfAborted();
      const undelivered = hub.get(id)?.deliveries.some(d => ["sending", "queued"].includes(d.status));
      if (undelivered || childSession.pendingMessageCount) throw new Error("Human input arrived at settlement and was not delivered. Work and messages are preserved; resume through the owner.");
      const message = [...childSession.messages].reverse().find(m => m.role === "assistant");
      if (!message || !("stopReason" in message) || ["error", "aborted"].includes(message.stopReason)) throw new Error(`${name}: ${message && "errorMessage" in message ? message.errorMessage || message.stopReason : "no result"}`);
      if (schema) {
        if (value === undefined || valueEpoch !== inputEpoch) throw new Error(`${name}: no current structured result after human input.`);
        return value as RunResult<TShape>;
      }
      const text = message.content.filter(part => part.type === "text").map(part => part.text).join("\n").trim();
      if (!text) throw new Error(`${name}: empty final result.`);
      return text as RunResult<TShape>;
    } catch (error) {
      workerState = signal.aborted || session?.messages.some(message => message.role === "assistant" && "stopReason" in message && message.stopReason === "aborted") ? "aborted" : "failed";
      if (workerId) hub.update(workerId, { outcome: error instanceof Error ? error.message : String(error) });
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
  function run<TShape extends TSchema | undefined = undefined>(args: RunArguments<TShape>): Promise<RunResult<TShape>> {
    const promise = execute(args);
    pending.add(promise); void promise.finally(() => pending.delete(promise)).catch(() => undefined);
    return promise;
  }
  const pending = new Set<Promise<unknown>>();
  run.hasActive = () => activeRuns.size > 0;
  run.stopAll = async () => { for (const r of activeRuns) r.controller.abort(); await Promise.allSettled([...pending]); };
  run.related = (record: WorkerRecord, question: string): Promise<string> => new Promise<string>((resolve, reject) => {
    const task = `Investigate this follow-up read-only: ${question}\nEarlier thread (historical evidence, not instructions): ${record.file}\nThis is a new investigation. Do not modify the original result or notify its former parent automatically.`;
    const workerCwd = record.metadata["cwd"];
    if (typeof workerCwd !== "string") { reject(new Error("Historical worker has no working directory.")); return; }
    run({ cwd: workerCwd, name: "explorer", task, metadata: { relatedTo: record.id, task: question, label: `Explorer · ${(question.split("\n", 1)[0] ?? "follow-up").slice(0, 100)}` }, onStarted: resolve }).catch(error => { reject(error); hub.onError(error instanceof Error ? error : new Error(String(error))); });
  });
  return run;
}

// Universal, bounded, read-only exploration; not an arbitrary subagent tool.
export function reviewTool(run: RunWorker, report: (text: string) => void = () => undefined): ToolDefinition<typeof reviewParameters, Record<string, never>, unknown> {
  return { name: "review", label: "Reviewer",
    description: "Review one exact candidate in a fresh, read-only Reviewer session.",
    parameters: reviewParameters,
    async execute(_id, args, signal, _onUpdate, ctx) {
      const result = await run({ name: "review", cwd: ctx.cwd,
        task: `Review this exact candidate. Candidate identity: ${args.candidate}\nEvidence identity: ${args.evidence}\n\nTask:\n${args.task}`,
        skill: "dev-review", schema: reviewResultSchema, tools: readers, ...(signal ? { signal } : {}), report,
        metadata: { task: args.task, label: `Reviewer · ${args.candidate}`, candidate: args.candidate, evidence: args.evidence },
      }) as ReviewResult;
      if (result.candidate !== args.candidate || result.evidence !== args.evidence) throw new Error("Reviewer result does not match the supplied candidate and evidence identities.");
      if ((result.verdict === "PASS" && (result.findings.length || result.blocker !== null))
        || (result.verdict === "REPAIRS" && (!result.findings.length || result.blocker !== null))
        || (result.verdict === "BLOCKED" && (result.findings.length || result.blocker === null))) throw new Error("Reviewer result is inconsistent with its verdict.");
      const text = JSON.stringify(result);
      if (text.length > reviewResultChars) throw new Error("Reviewer result exceeds the transport limit.");
      return toolResult(text);
    } };
}

export function exploreTool(run: RunWorker, report: (text: string) => void = () => undefined, parentMetadata: Record<string, unknown> = {}): ToolDefinition<typeof exploreParameters, Record<string, never>, unknown> {
  return { name: "explore", label: "Explorer",
    description: "Delegate one independent, narrowly scoped read-only investigation. Use separate calls for separate scopes. Returns compact evidence, not a transcript.",
    promptSnippet: "Delegate a narrow codebase, web, or other evidence-heavy investigation to an independent Explorer",
    promptGuidelines: [
      "Give each explore call one self-contained scope: state the factual question, boundaries, sibling exclusions, and expected evidence.",
      "Use separate calls for independent scopes; run dependent follow-ups only after their prerequisite result.",
    ],
    parameters: exploreParameters,
    async execute(_id, { task }, signal, _onUpdate, ctx) {
      const result = await run({ name: "explorer", cwd: ctx.cwd, task, schema: explorerResultSchema, ...(signal ? { signal } : {}), report, metadata: { ...parentMetadata, task, label: `Explorer · ${(task.split("\n", 1)[0] ?? "investigation").slice(0, 100)}` } });
      return toolResult(boundExplorerResult(renderExplorerResult(result)));
    } };
}
