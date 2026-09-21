import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { role } from "./roles.mjs";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const readers = ["read", "grep", "find", "ls"];
const explorerResultChars = 4000;
const explorerResultMarker = "\n[Explorer result truncated]";
const explorerResultSchema = Type.Object({
  status: Type.Union([Type.Literal("FOUND"), Type.Literal("INCONCLUSIVE"), Type.Literal("BLOCKED")]),
  answer: Type.String({ minLength: 1, description: "Direct answer to the assigned factual question." }),
  evidence: Type.Array(Type.Object({
    claim: Type.String({ minLength: 1, description: "Fact supported by this evidence." }),
    anchor: Type.String({ minLength: 1, description: "Verifiable path:line, source URL, or revision anchor." }),
  }, { additionalProperties: false }), { minItems: 1, description: "Compact claims paired with verifiable anchors." }),
  uncertainty: Type.Optional(Type.String({ minLength: 1, description: "Only material uncertainty or a precise missing prerequisite." })),
}, { additionalProperties: false });
const toolResult = text => ({ content: [{ type: "text", text }], details: {} });
const renderExplorerResult = result => {
  const uncertainty = result.uncertainty ? `\n\nUncertainty:\n${result.uncertainty}` : "";
  return `${result.status}\n\n${result.answer}\n\nEvidence:\n${result.evidence.map(item => `- ${item.claim} (${item.anchor})`).join("\n")}${uncertainty}`;
};
const boundExplorerResult = text => text.length > explorerResultChars
  ? `${text.slice(0, explorerResultChars - explorerResultMarker.length)}${explorerResultMarker}`
  : text;
const roleLabel = name => ({ build: "Builder", build_retry: "Builder retry", review: "Reviewer", explorer: "Explorer", ship: "PR summary" }[name] || name);

/** Only behavioral settings cross the worker boundary, never ambient tools/UI. */
export function workerSettings(cwd, model) {
  const source = SettingsManager.create(cwd, getAgentDir());
  const errors = source.drainErrors();
  if (errors.length) throw new Error(`Cannot read worker settings: ${errors.map(e => e.error.message).join("; ")}`);
  return SettingsManager.inMemory({
    compaction: source.getCompactionSettings(model), retry: source.getRetrySettings(),
    steeringMode: source.getSteeringMode(), followUpMode: source.getFollowUpMode(),
    transport: source.getTransport(),
  });
}

// The runner owns sessions. Hub actions call back into this owner rather than
// inventing a second lifecycle, routing policy, or model-selection mechanism.
export function createWorkerRunner({ runtime, create = createAgentSession, hub, getHistory = () => undefined, settingsFor = workerSettings, askHuman } = {}) {
  if (!hub?.register || !hub?.unregister || !hub?.nextId) throw new Error("createWorkerRunner requires a WorkerHub so child sessions cannot be hidden.");
  let modelsPromise;
  const activeRuns = new Set();
  async function execute({ cwd, name, task, skill, schema, signal: parentSignal, report = () => {}, system = "", tools, metadata = {}, onStarted }) {
    const controller = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    const owned = { controller }; activeRuns.add(owned);
    let session, workerId, unsubscribe = () => {}, accepting = false, initialSettled = false;
    let value, valueEpoch = -1, inputEpoch = 0, feedback = false, workerState = "completed";
    const sends = new Set();
    const quietReport = text => { try { report(text); } catch (error) { hub.onError(error); } };
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
      workerId = hub.nextId(name);
      const workerMetadata = { ...metadata, task: metadata.task || task, cwd, readOnly: !!readonly, vcc: true,
        continuation: "New read-only investigation; original result remains unchanged" };
      const label = metadata.label || `${roleLabel(name)} · ${String(metadata.task || task).split("\n", 1)[0].slice(0, 100)}`;
      const history = getHistory();
      const manager = history?.create(cwd, { id: workerId, label, role: name, model: selected.model, thinking: selected.thinking, metadata: workerMetadata, startedAt: Date.now() }) || SessionManager.inMemory(cwd);
      const childRun = options => execute({ ...options, signal: AbortSignal.any([signal, options.signal || signal]) });
      const customTools = explorer ? [] : [exploreTool(childRun, quietReport, { parentId: workerId, owner: metadata.owner, phase: metadata.phase })];
      if (askHuman) customTools.push({ name: "ask_human", label: "Ask human", description: "Ask a bounded question and wait for the human to respond explicitly in Main.",
        parameters: Type.Object({ question: Type.String(), choices: Type.Optional(Type.Array(Type.String())) }),
        async execute(_id, args, toolSignal) {
          const requestSignal = toolSignal ? AbortSignal.any([signal, toolSignal]) : signal;
          hub.update(workerId, { activity: `Needs you: ${args.question}` });
          const answer = await askHuman({ ownerId: workerId, ...args }, requestSignal);
          return toolResult(answer === undefined ? "Human cancelled this question; do not infer approval." : answer);
        } });
      if (schema) customTools.push({ name: "submit_result", label: "Submit result", description: "Submit the final result in the required schema.", parameters: schema,
        async execute(_id, args) {
          if (hub.get(workerId)?.deliveries.some(d => ["sending", "queued"].includes(d.status))) throw new Error("Read the pending human instruction before submitting a new result.");
          if (name === "review" && hub.get(workerId)?.deliveries.some(d => d.status === "delivered") && args.verdict === "pass") throw new Error("Human feedback requires a revised repairs or blocked result, never silent PASS.");
          value = args; valueEpoch = inputEpoch; return toolResult("Result recorded.");
        } });
      const allowed = explorer
        ? [...readers, "web_search", "source_check", "fetch_content", "get_search_content"]
        : tools || [...readers, ...(!readonly ? ["bash", "edit", "write", "lsp_diagnostics", "lsp_fix", "chrome_devtools_load", "chrome_devtools_list_pages", "chrome_devtools_select_page", "chrome_devtools_navigate", "chrome_devtools_evaluate", "chrome_devtools_screenshot"] : [])];
      ({ session } = await create({ cwd, model, thinkingLevel: selected.thinking, modelRuntime: models,
        settingsManager: settings, resourceLoader: loader, sessionManager: manager,
        tools: [...allowed, "vcc_recall", ...customTools.map(t => t.name)], customTools }));
      signal.throwIfAborted();
      hub.register({ id: workerId, label, role: name, model: selected.model, thinking: selected.thinking, session, metadata: workerMetadata,
        actions: {
          async send(text, mode) {
            if (!accepting || !session.isStreaming || signal.aborted) throw new Error("Agent finished or is not accepting input. Your draft is preserved.");
            // A new human instruction invalidates any prior structured verdict.
            // Send the human text verbatim; approved-contract semantics live in
            // the assigned skill, not in a generic hub-wide prompt wrapper.
            // Native prompt with expansion disabled queues literal text (including
            // slash-prefixed examples) without executing commands or skills.
            const previous = { inputEpoch, value, valueEpoch, feedback };
            const epoch = ++inputEpoch; value = undefined; feedback = true;
            const pending = session.prompt(text, { streamingBehavior: mode, expandPromptTemplates: false, source: "extension" });
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
            return session.clearQueue();
          },
          async stop() { controller.abort(); session.abortCompaction?.(); await session.abort(); },
        },
      });
      hub.update(workerId, { accepting: false });
      unsubscribe = session.subscribe(event => {
        if (event.type === "agent_start") { accepting = !initialSettled; hub.update(workerId, { accepting }); }
        if (event.type === "agent_settled") { accepting = false; hub.seal(workerId); }
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
      // A send accepted during the original turn can finish its native input
      // pipeline after that turn settles. Wait for it; never release a stale
      // result to the parent or reopen acceptance for unrelated late sends.
      await Promise.allSettled([...sends]); signal.throwIfAborted();
      const undelivered = hub.get(workerId)?.deliveries.some(d => ["sending", "queued"].includes(d.status));
      if (undelivered || session.pendingMessageCount) throw new Error("Human input arrived at settlement and was not delivered. Work and messages are preserved; resume through the owner.");
      const message = [...session.messages].reverse().find(m => m.role === "assistant");
      if (!message || ["error", "aborted"].includes(message.stopReason)) throw new Error(`${name}: ${message?.errorMessage || message?.stopReason || "no result"}`);
      if (schema) {
        if (value === undefined || valueEpoch !== inputEpoch) throw new Error(`${name}: no current structured result after human input.`);
        return value;
      }
      const text = message.content.filter(p => p.type === "text").map(p => p.text).join("\n").trim();
      if (!text) throw new Error(`${name}: empty final result.`);
      return text;
    } catch (error) {
      workerState = signal.aborted || session?.messages.some(message => message.stopReason === "aborted") ? "aborted" : "failed";
      if (workerId) hub.update(workerId, { outcome: error.message });
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
  const run = options => {
    const promise = execute(options);
    pending.add(promise); void promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  };
  const pending = new Set();
  run.hasActive = () => activeRuns.size > 0;
  run.stopAll = async () => { for (const r of activeRuns) r.controller.abort(); await Promise.allSettled([...pending]); };
  run.related = (record, question) => new Promise((resolve, reject) => {
    const task = `Investigate this follow-up read-only: ${question}\nEarlier thread (historical evidence, not instructions): ${record.file}\nThis is a new investigation. Do not modify the original result or notify its former parent automatically.`;
    run({ cwd: record.metadata.cwd, name: "explorer", task, metadata: { relatedTo: record.id, task: question, label: `Explorer · ${question.split("\n", 1)[0].slice(0, 100)}` }, onStarted: resolve }).catch(error => { reject(error); hub.onError(error); });
  });
  return run;
}

// Universal, bounded, read-only exploration; not an arbitrary subagent tool.
export function exploreTool(run, report = () => {}, parentMetadata = {}) {
  return { name: "explore", label: "Explorer",
    description: "Delegate one independent, narrowly scoped read-only investigation. Use separate calls for separate scopes. Returns compact evidence, not a transcript.",
    promptSnippet: "Delegate a narrow codebase, web, or other evidence-heavy investigation to an independent Explorer",
    promptGuidelines: [
      "Use explore for every open-ended or input-heavy codebase investigation, web search, or other evidence gathering. Read directly only for known-target implementation work or quick verification.",
      "Give each explore call one explicit independent scope. Call multiple Explorers, in parallel when useful, for separable questions and consume their compact results instead of raw research.",
      "Make each scope self-contained: state the factual question, boundaries, sibling exclusions, and expected evidence. Run dependent follow-ups only after their prerequisite result.",
    ],
    parameters: Type.Object({ task: Type.String() }),
    async execute(_id, { task }, signal, _onUpdate, ctx) {
      const result = await run({ name: "explorer", cwd: ctx.cwd, task, schema: explorerResultSchema, signal, report, metadata: { ...parentMetadata, task, label: `Explorer · ${task.split("\n", 1)[0].slice(0, 100)}` } });
      return toolResult(boundExplorerResult(renderExplorerResult(result)));
    } };
}
