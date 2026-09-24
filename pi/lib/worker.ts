import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import { role, type RoleName } from "./roles.ts";
import type { WorkerHistory } from "./worker-history.ts";
import type { WorkerHub } from "./worker-hub.ts";
import type { WorkerRecord, WorkerSession, WorkerState } from "./worker-types.ts";
import { candidateFingerprint, createVerifierTool } from "./verifier.ts";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const readers = ["read", "grep", "find", "ls"];
const explorerResultChars = 4000;
const explorerResultMarker = "\n[Explorer result truncated]";
const reviewResultChars = 12000;
const reviewTimeoutMs = 300_000;
const exploreParameters = Type.Object({ task: Type.String() });
const reviewPurpose = Type.Union([Type.Literal("broad"), Type.Literal("repair-audit")]);
const reviewParameters = Type.Object({
  purpose: reviewPurpose,
  task: Type.String({ minLength: 1, maxLength: 12000 }),
  candidate: Type.String({ minLength: 1, maxLength: 2000 }),
  evidence: Type.String({ minLength: 1, maxLength: 12000 }),
  focus: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 20 }),
}, { additionalProperties: false });
const reviewResultSchema = Type.Object({
  purpose: reviewPurpose,
  verdict: Type.Union([Type.Literal("PASS"), Type.Literal("REPAIRS"), Type.Literal("BLOCKED")]),
  candidate: Type.String({ minLength: 1, maxLength: 2000 }),
  evidence: Type.String({ minLength: 1, maxLength: 12000 }),
  focus: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 20 }),
  coverage: Type.Array(Type.Object({
    focus: Type.String({ minLength: 1, maxLength: 500 }),
    status: Type.Union([Type.Literal("examined"), Type.Literal("finding"), Type.Literal("unexamined")]),
    evidence: Type.String({ minLength: 1, maxLength: 2000 }),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 20 }),
  summary: Type.String({ minLength: 1, maxLength: 4000 }),
  findings: Type.Array(Type.Object({
    key: Type.String({ minLength: 1, maxLength: 200 }),
    title: Type.String({ minLength: 1, maxLength: 500 }),
    problem: Type.String({ minLength: 1, maxLength: 4000 }),
    evidence: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { maxItems: 20 }),
    acceptance_checks: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { minItems: 1, maxItems: 20 }),
  }, { additionalProperties: false }), { maxItems: 30 }),
  blocker: Type.Union([Type.String({ minLength: 1, maxLength: 4000 }), Type.Null()]),
}, { additionalProperties: false });
export type ReviewRequest = Static<typeof reviewParameters>;
export type ReviewResult = Static<typeof reviewResultSchema>;
export interface ReviewReservation { effort: string; purpose: ReviewRequest["purpose"]; id: string }
export interface ReviewLaunchGate {
  reserve(request: ReviewRequest): ReviewReservation;
  started(reservation: ReviewReservation, workerId: string): void;
  completed(reservation: ReviewReservation, status: "completed" | "failed", result: string): void;
  release(reservation: ReviewReservation): void;
}
export interface AsyncWorkerCompletion {
  id: string;
  ownerSessionId?: string;
  ownerGoal?: string;
  role: "Explorer" | "Reviewer" | "Verifier";
  task: string;
  status: "completed" | "failed";
  result: string;
}
export type PublishAsyncWorkerCompletion = (completion: AsyncWorkerCompletion) => void | Promise<void>;
export type TrackAsyncWorkerCompletion = (completion: Promise<void>) => void;
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
const terminalToolResult = (text: string) => ({ ...toolResult(text), terminate: true as const });
const renderExplorerResult = (result: ExplorerResult): string => {
  const uncertainty = result.uncertainty ? `\nUncertainty: ${result.uncertainty}` : "";
  return `${result.status}\n${result.answer}\nEvidence:\n${result.evidence.map((item: ExplorerResult["evidence"][number]) => `- ${item.claim} (${item.anchor})`).join("\n")}${uncertainty}`;
};
const boundExplorerResult = (text: string): string => text.length > explorerResultChars
  ? `${text.slice(0, explorerResultChars - explorerResultMarker.length)}${explorerResultMarker}`
  : text;
const roleLabels: Partial<Record<RoleName, string>> = { build: "Builder", review: "Reviewer", explorer: "Explorer", ship: "Shipper" };
const roleLabel = (name: RoleName): string => roleLabels[name] ?? name;
const gitRoot = (cwd: string): string | undefined => {
  try { return fs.realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()); }
  catch { return undefined; }
};
const worktreeRoot = (cwd: string): string => gitRoot(cwd) ?? fs.realpathSync(cwd);

/** Read-only agents get an immutable snapshot. Reviews include the exact dirty, non-ignored candidate. */
export function readOnlySnapshot(cwd: string, expectedCandidate?: string): { cwd: string; dispose(): void } {
  const root = gitRoot(cwd);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-evidence-"));
  const snapshot = path.join(directory, "worktree");
  try {
    if (root) {
      if (expectedCandidate && candidateFingerprint(root) !== expectedCandidate) throw new Error("Review candidate does not match the current owner worktree. Refresh candidate and evidence before review.");
      execFileSync("git", ["worktree", "add", "--detach", "--quiet", snapshot, "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      if (expectedCandidate) {
        const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
          .toString("utf8").split("\0").filter(Boolean);
        for (const relative of paths) {
          const source = path.resolve(root, relative), target = path.resolve(snapshot, relative);
          if ((!source.startsWith(`${root}${path.sep}`) && source !== root) || (!target.startsWith(`${snapshot}${path.sep}`) && target !== snapshot)) throw new Error("Candidate contains an unsafe path.");
          fs.rmSync(target, { recursive: true, force: true });
          if (!fs.existsSync(source) && !fs.lstatSync(source, { throwIfNoEntry: false })) continue;
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.cpSync(source, target, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
        }
        if (candidateFingerprint(root) !== expectedCandidate || candidateFingerprint(snapshot) !== expectedCandidate) throw new Error("Review candidate changed while its snapshot was being created. Retry with refreshed candidate and evidence.");
      }
    } else {
      const relative = path.relative(fs.realpathSync(cwd), directory);
      if (relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error("Cannot snapshot a directory containing the temporary workspace.");
      fs.cpSync(cwd, snapshot, { recursive: true });
      if (expectedCandidate && candidateFingerprint(snapshot) !== expectedCandidate) throw new Error("Review candidate identity does not match the immutable snapshot.");
    }
  } catch (error) {
    try { if (root && fs.existsSync(snapshot)) execFileSync("git", ["worktree", "remove", "--force", snapshot], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }); }
    finally { fs.rmSync(directory, { recursive: true, force: true }); }
    throw error;
  }
  let disposed = false;
  return { cwd: snapshot, dispose() {
    if (disposed) return;
    disposed = true;
    try { if (root) execFileSync("git", ["worktree", "remove", "--force", snapshot], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }); }
    finally { fs.rmSync(directory, { recursive: true, force: true }); }
  } };
}

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
  /** Narrow tools inherited only by descendants of this worker run. */
  scopedTools?: ToolDefinition[];
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
  ownerCwd?: () => string | undefined;
  settingsFor?: typeof workerSettings;
  askHuman?: (request: { ownerId: string; question: string; choices?: string[] }, signal?: AbortSignal) => Promise<string | undefined>;
}
interface ActiveRun { controller: AbortController }

// The runner owns sessions. Hub actions call back into this owner rather than
// inventing a second lifecycle, routing policy, or model-selection mechanism.
export function createWorkerRunner(options: RunnerOptions): WorkerRunner {
  const { runtime, create = createAgentSession, hub, getHistory = () => undefined, ownerCwd = () => undefined, settingsFor = workerSettings, askHuman } = options;
  if (!hub?.register || !hub?.unregister || !hub?.nextId) throw new Error("createWorkerRunner requires a WorkerHub so child sessions cannot be hidden.");
  let modelsPromise: Promise<ModelRuntime> | undefined;
  const activeRuns = new Set<ActiveRun>();
  async function execute<TShape extends TSchema | undefined = undefined>({ cwd, name, task, skill, schema, signal: parentSignal, report = () => undefined, system = "", tools, scopedTools = [], metadata = {}, onStarted }: RunArguments<TShape>): Promise<RunResult<TShape>> {
    const controller = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    const owned = { controller }; activeRuns.add(owned);
    let session: AgentSession | undefined;
    let snapshot: ReturnType<typeof readOnlySnapshot> | undefined;
    let workerId: string | undefined;
    let unsubscribe: () => void = () => undefined;
    let accepting = false, initialSettled = false;
    let value: unknown, valueEpoch = -1, inputEpoch = 0, feedback = false;
    let workerState: WorkerState = "completed";
    const sends = new Set<Promise<void>>();
    const detachedCompletions = new Set<Promise<void>>();
    const quietReport = (text: string): void => { try { report(text); } catch (error) { hub.onError(error instanceof Error ? error : new Error(String(error))); } };
    const trackDetachedCompletion: TrackAsyncWorkerCompletion = completion => {
      detachedCompletions.add(completion);
      void completion.finally(() => detachedCompletions.delete(completion)).catch(() => undefined);
    };
    const abort = () => { session?.abortCompaction?.(); void session?.abort().catch(error => hub.onError(error)); };
    try {
      signal.throwIfAborted();
      if (name === "assessor") throw new Error("The assessor is a narrow classification call, not a child worker.");
      const selected = role(name);
      const explorer = name === "explorer";
      const readonly = explorer || name === "review" || (tools && !tools.some(t => ["bash", "write", "edit", "lsp_fix"].includes(t)));
      const owner = ownerCwd();
      if (!readonly && owner && worktreeRoot(cwd) === worktreeRoot(owner)) throw new Error("A writing child must own a different worktree from its parent.");
      const models = runtime || await (modelsPromise ||= ModelRuntime.create().catch(error => { modelsPromise = undefined; throw error; }));
      const model = models.getModel(selected.provider, selected.model);
      if (!model) throw new Error(`Pi does not list ${selected.provider}/${selected.model}; no model fallback is allowed.`);
      if (!models.hasConfiguredAuth(selected.provider)) throw new Error(`No login for ${selected.provider}. Use Pi /login; no model/provider fallback was attempted.`);
      if (readonly) snapshot = readOnlySnapshot(cwd, name === "review" && typeof metadata["candidate"] === "string" ? metadata["candidate"] : undefined);
      const workerCwd = snapshot?.cwd ?? cwd;
      const assignedSkill = explorer ? "dev-explore" : skill;
      const settings = settingsFor(cwd, model);
      const loader = new DefaultResourceLoader({ cwd: workerCwd, agentDir: getAgentDir(), settingsManager: settings,
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
      const workerMetadata = { ...metadata, task: metadata.task || task, cwd, snapshotCwd: snapshot?.cwd, ownerCwd: owner ?? cwd, readOnly: !!readonly, vcc: true,
        continuation: "New read-only investigation; original result remains unchanged" };
      const label = metadata.label || `${roleLabel(name)} · ${(String(metadata.task || task).split("\n", 1)[0] ?? name).slice(0, 100)}`;
      const history = getHistory();
      const manager = history?.create(workerCwd, { id, label, role: name, model: selected.model, thinking: selected.thinking, metadata: workerMetadata, startedAt: Date.now() }) || SessionManager.inMemory(workerCwd);
      const childRun: RunWorker = <TChildShape extends TSchema | undefined = undefined>(args: RunArguments<TChildShape>) => execute({ ...args, scopedTools: args.scopedTools ?? scopedTools, signal: AbortSignal.any([signal, args.signal ?? signal]) });
      const publishNestedCompletion: PublishAsyncWorkerCompletion = async completion => {
        if (!session || signal.aborted) return;
        const previous = { inputEpoch, value, valueEpoch, feedback };
        const epoch = ++inputEpoch; value = undefined; feedback = true;
        try {
          await session.prompt(renderAsyncWorkerCompletion(completion), { streamingBehavior: "followUp", expandPromptTemplates: false, source: "extension" });
        } catch (error) {
          if (inputEpoch === epoch) {
            inputEpoch = previous.inputEpoch; feedback = previous.feedback;
            if (value !== undefined && valueEpoch === epoch) valueEpoch = inputEpoch;
            else { value = previous.value; valueEpoch = previous.valueEpoch; }
          }
          hub.onError(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
      };
      const verifier = !explorer && name !== "review" ? createVerifierTool(publishNestedCompletion, { track: trackDetachedCompletion, ownerCwd: () => cwd }) : undefined;
      signal.addEventListener("abort", () => verifier?.cancelAll(), { once: true });
      const customTools: ToolDefinition[] = [...scopedTools, ...(explorer ? [] : [asyncExploreTool(childRun, publishNestedCompletion, quietReport, trackDetachedCompletion, { parentId: id, owner: metadata.owner, phase: metadata.phase }) as unknown as ToolDefinition, ...(verifier ? [verifier.tool] : [])])];
      if (askHuman && !readonly && metadata.phase !== "ship") {
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
      if (schema) customTools.push({ name: "submit_result", label: "Submit result", description: explorer ? "Submit the final result in the required schema and end this Explorer run." : "Submit the final result in the required schema.", parameters: schema,
        async execute(_id: string, args: Static<NonNullable<TShape>>) {
          if (hub.get(id)?.deliveries.some(d => ["sending", "queued"].includes(d.status))) throw new Error("Read the pending human instruction before submitting a new result.");
          if (name === "review" && hub.get(id)?.deliveries.some(d => d.status === "delivered") && args["verdict"] === "pass") throw new Error("Human feedback requires a revised repairs or blocked result, never silent PASS.");
          value = args; valueEpoch = inputEpoch; return explorer ? terminalToolResult("Result recorded.") : toolResult("Result recorded.");
        } });
      const allowed = explorer
        ? [...readers, "bash", "web_search", "source_check", "fetch_content", "get_search_content", ...scopedTools.map(tool => tool.name)]
        : name === "review" ? [...readers, ...scopedTools.map(tool => tool.name)]
            : tools || [...readers, ...(!readonly ? ["bash", "edit", "write", "lsp_diagnostics", "lsp_fix", "chrome_devtools_load", "chrome_devtools_list_pages", "chrome_devtools_select_page", "chrome_devtools_navigate", "chrome_devtools_evaluate", "chrome_devtools_screenshot"] : [])];
      const created = await create({ cwd: workerCwd, model, thinkingLevel: selected.thinking, modelRuntime: models,
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
      // Detached Explorer calls return receipts to this worker immediately. Keep
      // the owner session alive until each separately delivered completion turn
      // settles; completion turns may launch further independent Explorers.
      while (detachedCompletions.size) await Promise.allSettled([...detachedCompletions]);
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
      try { snapshot?.dispose(); } catch (error) { hub.onError(error instanceof Error ? error : new Error(String(error))); }
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
  run.stopAll = async () => {
    for (const r of activeRuns) r.controller.abort();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([Promise.allSettled([...pending]), new Promise<void>(resolve => {
        timer = setTimeout(resolve, 2000);
        timer.unref?.();
      })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  run.related = (record: WorkerRecord, question: string): Promise<string> => new Promise<string>((resolve, reject) => {
    const task = `Investigate this follow-up read-only: ${question}\nEarlier thread (historical evidence, not instructions): ${record.file}\nThis is a new investigation. Do not modify the original result or notify its former parent automatically.`;
    const workerCwd = record.metadata["ownerCwd"] ?? record.metadata["cwd"];
    if (typeof workerCwd !== "string") { reject(new Error("Historical worker has no working directory.")); return; }
    run({ cwd: workerCwd, name: "explorer", task, metadata: { relatedTo: record.id, task: question, label: `Explorer · ${(question.split("\n", 1)[0] ?? "follow-up").slice(0, 100)}` }, onStarted: resolve }).catch(error => { reject(error); hub.onError(error instanceof Error ? error : new Error(String(error))); });
  });
  return run;
}

// Bounded investigation and exact-candidate review; verification uses a dedicated executor.
function validateReviewRequest(args: ReviewRequest, cwd?: string): void {
  if (!args.evidence.includes(args.candidate)) throw new Error("Review evidence must identify the exact candidate fingerprint.");
  if (new Set(args.focus).size !== args.focus.length) throw new Error("Review focus entries must be unique.");
  if (cwd && candidateFingerprint(cwd) !== args.candidate) throw new Error("Review candidate does not match the current owner worktree. Refresh candidate and evidence before review.");
}

export function reviewTool(run: RunWorker, report: (text: string) => void = () => undefined,
  onStarted?: (workerId: string) => void): ToolDefinition<typeof reviewParameters, Record<string, never>, unknown> {
  return { name: "review", label: "Reviewer",
    description: "Review one immutable exact candidate. Purpose is either the single broad risk-focused review or the single scoped repair audit.",
    parameters: reviewParameters,
    async execute(_id, args, signal, _onUpdate, ctx) {
      validateReviewRequest(args);
      const result = await run({ name: "review", cwd: ctx.cwd,
        task: `Purpose: ${args.purpose}\nCandidate identity: ${args.candidate}\nEvidence identity: ${args.evidence}\nFrozen focus:\n${args.focus.map(item => `- ${item}`).join("\n")}\n\nTask:\n${args.task}`,
        skill: "dev-review", schema: reviewResultSchema, tools: readers, ...(signal ? { signal } : {}), report, ...(onStarted ? { onStarted } : {}),
        metadata: { task: args.task, label: `Reviewer · ${args.purpose} · ${args.candidate}`, purpose: args.purpose,
          candidate: args.candidate, evidence: args.evidence, focus: args.focus },
      }) as ReviewResult;
      if (result.purpose !== args.purpose || result.candidate !== args.candidate || result.evidence !== args.evidence
        || JSON.stringify(result.focus) !== JSON.stringify(args.focus)) throw new Error("Reviewer result does not match the frozen purpose, candidate, evidence, and focus.");
      const covered = new Map(result.coverage.map(item => [item.focus, item]));
      if (covered.size !== result.coverage.length || args.focus.some(item => !covered.has(item)) || result.coverage.some(item => !args.focus.includes(item.focus))) throw new Error("Reviewer result does not account for every frozen focus exactly once.");
      if ((result.verdict === "PASS" && (result.findings.length || result.blocker !== null || result.coverage.some(item => item.status !== "examined")))
        || (result.verdict === "REPAIRS" && (!result.findings.length || result.blocker !== null))
        || (result.verdict === "BLOCKED" && (result.findings.length || result.blocker === null))) throw new Error("Reviewer result is inconsistent with its verdict.");
      const text = JSON.stringify(result);
      if (text.length > reviewResultChars) throw new Error("Reviewer result exceeds the transport limit.");
      return toolResult(text);
    } };
}

export function exploreTool(run: RunWorker, report: (text: string) => void = () => undefined, parentMetadata: Record<string, unknown> = {}): ToolDefinition<typeof exploreParameters, Record<string, never>, unknown> {
  return { name: "explore", label: "Explorer",
    description: "Delegate one independent, narrowly scoped read-only investigation, especially when it may be materially slow or high-output. Returns compact evidence, not raw output.",
    promptSnippet: "Delegate a narrow codebase, web, or other evidence-heavy investigation to an independent Explorer",
    promptGuidelines: [
      "Delegate read-only evidence gathering when it is reasonably expected to take material time or produce substantial raw output, including broad repository or web research.",
      "Keep quick known-target reads in the parent when delegation would cost more than it saves.",
      "The Explorer works in a separate HEAD snapshot, not the owner's dirty worktree; request live uncommitted investigative evidence explicitly or inspect it in the parent.",
      "Keep edits, installs, Git mutation, interactive or privileged work, and project decisions in the parent.",
      "Give each explore call one self-contained scope: state the factual question or command, boundaries, sibling exclusions, and expected evidence.",
      "Use separate calls for independent scopes; run dependent follow-ups only after their prerequisite result.",
      "All Explorer calls are asynchronous, including worker-owned calls; callers never await Explorer calls and continue from separately delivered results.",
      "If Explorer is unavailable or an invocation fails, perform only necessary permitted read-only work directly, keep output bounded, state the fallback, and do not bypass unavailable or prohibited tools.",
    ],
    parameters: exploreParameters,
    async execute(_id, { task }, signal, _onUpdate, ctx) {
      const result = await run({ name: "explorer", cwd: ctx.cwd, task, schema: explorerResultSchema, ...(signal ? { signal } : {}), report, metadata: { ...parentMetadata, task, label: `Explorer · ${(task.split("\n", 1)[0] ?? "investigation").slice(0, 100)}` } });
      return toolResult(boundExplorerResult(renderExplorerResult(result)));
    } };
}

const resultText = (result: Awaited<ReturnType<ToolDefinition["execute"]>>): string => {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) return String(result);
  return result.content.filter(part => part.type === "text").map(part => part.text).join("\n").trim();
};

export function renderAsyncWorkerCompletion(completion: AsyncWorkerCompletion): string {
  return `${completion.id} ${completion.status}\n${completion.result}`;
}

function publishDetached(
  role: AsyncWorkerCompletion["role"], task: string,
  work: Promise<Awaited<ReturnType<ToolDefinition["execute"]>>>, publish: PublishAsyncWorkerCompletion,
  track?: TrackAsyncWorkerCompletion,
  ownerSessionId?: string,
  ownerGoal = "",
  started?: (id: string, ownerGoal: string, timeoutMs?: number) => void,
  suppliedId?: string,
  timeoutMs?: number,
): string {
  const id = suppliedId ?? `${role.toLowerCase()}:${randomUUID()}`;
  started?.(id, ownerGoal, timeoutMs);
  const notify = async (completion: AsyncWorkerCompletion): Promise<void> => { try { await publish(completion); } catch { /* completion remains in Agent Hub history */ } };
  const origin = { ...(ownerSessionId ? { ownerSessionId } : {}), ownerGoal };
  const completion = work.then(
    result => notify({ id, role, task, status: "completed", result: resultText(result), ...origin }),
    error => notify({ id, role, task, status: "failed", result: error instanceof Error ? error.message : String(error), ...origin }),
  );
  track?.(completion);
  void completion.catch(() => undefined);
  return id;
}

/** Detached Explorer adapter shared by Main and worker-owned parent sessions. */
export function asyncExploreTool(run: RunWorker, publish: PublishAsyncWorkerCompletion, report: (text: string) => void = () => undefined, track?: TrackAsyncWorkerCompletion, parentMetadata: Record<string, unknown> = {}, ownerSessionId?: () => string | undefined,
  ownerGoal?: () => string, started?: (id: string, ownerGoal: string) => void): ReturnType<typeof exploreTool> {
  const foreground = exploreTool(run, report, parentMetadata);
  return { ...foreground,
    description: "Start an independent investigation in the background. Returns immediately; the result is delivered asynchronously.",
    promptGuidelines: [
      ...(foreground.promptGuidelines || []),
      "Start independent investigations without waiting. Continue useful work; each result will arrive automatically and trigger progress.",
      "If a result is required for the next decision, stop after exhausting independent work. Do not poll or repeat the investigation.",
    ],
    async execute(callId, args, _signal, onUpdate, ctx) {
      const id = publishDetached("Explorer", args.task, Promise.resolve(foreground.execute(callId, args, undefined, onUpdate, ctx)), publish, track, ownerSessionId?.(), ownerGoal?.() ?? "", started);
      return toolResult(`Explorer ${id} started.`);
    },
  };
}

export function asyncReviewTool(run: RunWorker, publish: PublishAsyncWorkerCompletion, report: (text: string) => void = () => undefined,
  ownerSessionId?: () => string | undefined, ownerGoal?: () => string,
  started?: (id: string, ownerGoal: string, timeoutMs?: number) => void, gate?: ReviewLaunchGate): ReturnType<typeof reviewTool> {
  const shape = reviewTool(run, report);
  return { ...shape,
    description: "Start one bounded broad review or one bounded repair audit for the active shipping effort. Returns immediately; the verdict is delivered asynchronously.",
    promptGuidelines: [
      ...(shape.promptGuidelines || []),
      "Use purpose broad once for whole-scope accounting with deep attention to the supplied risks. Batch findings and give each concrete closure checks.",
      "Use purpose repair-audit only once, after repairs, and freeze focus to accepted finding keys plus directly affected invariants. Never turn it into another full review.",
      "Continue independent work while review runs. Its verdict will arrive automatically and trigger progress.",
      "If the verdict gates the next decision, stop after exhausting independent work. Do not poll or launch a duplicate review.",
    ],
    async execute(callId, args, _signal, onUpdate, ctx) {
      validateReviewRequest(args, gate ? ctx.cwd : undefined);
      const reservation = gate?.reserve(args);
      const id = `reviewer:${randomUUID()}`;
      let began = false;
      const timeout = AbortSignal.timeout(reviewTimeoutMs);
      const foreground = reviewTool(run, report, workerId => {
        if (reservation) gate?.started(reservation, workerId);
        began = true;
      });
      const work = Promise.resolve(foreground.execute(callId, args, timeout, onUpdate, ctx)).then(result => {
        if (reservation) gate?.completed(reservation, "completed", resultText(result));
        return result;
      }, error => {
        if (reservation) {
          if (began) gate?.completed(reservation, "failed", error instanceof Error ? error.message : String(error));
          else gate?.release(reservation);
        }
        throw error;
      });
      const receipt = publishDetached("Reviewer", args.task, work, publish, undefined, ownerSessionId?.(), ownerGoal?.() ?? "", started, id, reviewTimeoutMs + 30_000);
      return toolResult(receipt);
    },
  };
}
