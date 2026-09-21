import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { role } from "./roles.mjs";
import { humanEditor } from "./human-editor.mjs";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const readers = ["read", "grep", "find", "ls"];
const explorerResultChars = 4000;
const toolResult = text => ({ content: [{ type: "text", text }], details: {} });
const textOf = message => typeof message?.content === "string" ? message.content : (message?.content || []).filter(p => p.type === "text").map(p => p.text).join("\n");
const contractMessage = text => `${text}\n\nThis instruction applies within the assigned approved contract. If it changes that contract, stop and return NEEDS_REPLAN with evidence.`;

export function createWorkerRunner({ runtime, create = createAgentSession, hub } = {}) {
  if (!hub?.register || !hub?.unregister || !hub?.nextId) throw new Error("createWorkerRunner requires a WorkerHub so child sessions cannot be hidden.");
  let modelsPromise;

  async function run({ cwd, name, task, skill, schema, signal, report = () => {}, system = "", tools, metadata = {}, rejectPassOnFeedback = false, onRegistered }) {
    const selected = role(name);
    const lifetime = new AbortController();
    const parentAbort = () => lifetime.abort(signal?.reason);
    if (signal?.aborted) parentAbort();
    signal?.addEventListener("abort", parentAbort, { once: true });
    const workerId = hub.nextId(name);
    let session, unsubscribe = () => {}, accepting = false, outcome = "completed", value;
    let intervention = 0, submittedAt = -1;
    const sends = new Set(), deliveries = new Set();
    const safeReport = text => { try { report(text); } catch { /* UI errors cannot change engineering results. */ } };
    const stop = async () => {
      accepting = false; lifetime.abort(new Error("Worker stopped by human; partial changes are preserved."));
      session?.abortCompaction?.();
      await session?.abort();
    };
    const abortSession = () => { session?.abortCompaction?.(); void session?.abort().catch(() => {}); };
    lifetime.signal.addEventListener("abort", abortSession);
    const controls = {
      stop,
      async send(text, mode, receipt) {
        if (!accepting || lifetime.signal.aborted || !session?.isStreaming) throw new Error("This attempt finished before acceptance. Your message has not been delivered.");
        if (text.trimStart().startsWith("/")) throw new Error("Use Main for slash commands. This composer sends instructions to the named child only.");
        receipt.wireText = metadata.policy === "contract" ? contractMessage(text) : text;
        const pending = session[mode](receipt.wireText);
        sends.add(pending);
        try { await pending; } finally { sends.delete(pending); }
      },
      cancelQueued() {
        if (!session || !accepting) throw new Error("This worker no longer has an active queue.");
        const removed = session.clearQueue();
        const texts = [...removed.steering, ...removed.followUp];
        for (const receipt of hub.get(workerId).receipts) {
          if (["queued", "sending"].includes(receipt.state) && texts.includes(receipt.wireText)) receipt.state = "cancelled";
        }
        hub.update(workerId, { activity: `Cancelled ${texts.length} queued messages; original text retained` });
        return texts.length;
      },
    };
    try {
      lifetime.signal.throwIfAborted();
      if (hub.historyFailure) throw new Error(`Restore agent history storage before starting: ${hub.historyFailure.message}`);
      hub.register({ id: workerId, label: metadata.label || `${name} · ${String(metadata.task || task).split("\n")[0].slice(0, 100)}`,
        role: name, model: selected.model, thinking: selected.thinking, controls, state: "starting",
        metadata: { ...metadata, cwd, task: metadata.task || task, producer: "dev-workflow", parentId: metadata.parentId || "main" } });
      onRegistered?.(workerId);
      const models = runtime || await (modelsPromise ||= ModelRuntime.create().catch(error => { modelsPromise = undefined; throw error; }));
      lifetime.signal.throwIfAborted();
      const model = models.getModel(selected.provider, selected.model);
      if (!model) throw new Error(`Pi does not list ${selected.provider}/${selected.model}; no model fallback is allowed.`);
      if (!models.hasConfiguredAuth(selected.provider)) throw new Error(`No login for ${selected.provider}. Use Pi /login; no model/provider fallback was attempted.`);
      const explorer = name === "explorer";
      const readonly = explorer || name === "review";
      const assignedSkill = explorer ? "dev-explore" : skill;
      const settings = SettingsManager.create(cwd, getAgentDir());
      const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), settingsManager: settings,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
        additionalExtensionPaths: [path.join(packageDir, "node_modules/@sting8k/pi-vcc/index.ts"), path.join(packageDir, "node_modules/pi-web-access/dist/index.js"),
          ...(!readonly ? [path.join(packageDir, "node_modules/@narumitw/pi-lsp/dist/index.ts"), path.join(packageDir, "node_modules/@narumitw/pi-chrome-devtools/dist/index.ts")] : [])],
        additionalSkillPaths: assignedSkill ? [path.join(packageDir, "skills", assignedSkill)] : [], appendSystemPrompt: [system].filter(Boolean) });
      await loader.reload(); lifetime.signal.throwIfAborted();
      const loaded = loader.getExtensions();
      if (loaded.errors.length) throw new Error(`Worker extension load failed: ${loaded.errors.map(e => `${e.path}: ${e.error}`).join("; ")}`);
      if (assignedSkill && !loader.getSkills().skills.some(s => s.name === assignedSkill)) throw new Error(`Missing worker skill ${assignedSkill}`);
      const memoryTools = loaded.extensions.filter(e => e.resolvedPath.includes("/@sting8k/pi-vcc/")).flatMap(e => [...e.tools.keys()]);
      const customTools = explorer ? [] : [exploreTool(run, safeReport, { parentId: workerId, workflowId: metadata.workflowId })];
      customTools.push({ name: "ask_human", label: "Ask human", description: "Ask a specific question and wait for the human's answer in Agent Hub.",
        parameters: Type.Object({ question: Type.String(), choices: Type.Optional(Type.Array(Type.String())) }),
        async execute(_id, args, toolSignal) {
          const requestSignal = toolSignal ? AbortSignal.any([toolSignal, lifetime.signal]) : lifetime.signal;
          const answer = await hub.request({ ownerId: workerId, title: args.question, run: async ctx => args.choices?.length
            ? ctx.ui.select(args.question, args.choices, { signal: requestSignal })
            : humanEditor(ctx, args.question, "", requestSignal) }, requestSignal);
          return toolResult(answer === undefined ? "Human cancelled this question." : answer);
        } });
      if (schema) customTools.push({ name: "submit_result", label: "Submit result", description: "Submit the final result in the required schema.", parameters: schema,
        async execute(_id, args) { value = args; submittedAt = intervention; return toolResult("Result recorded."); } });
      const allowed = tools || [...readers, ...(!readonly ? ["bash", "edit", "write", "lsp_diagnostics", "lsp_fix", "chrome_devtools_load", "chrome_devtools_list_pages", "chrome_devtools_select_page", "chrome_devtools_navigate", "chrome_devtools_evaluate", "chrome_devtools_screenshot"] : []),
        ...(explorer ? ["web_search", "source_check", "fetch_content", "get_search_content"] : [])];
      const sessionManager = hub.history ? hub.history.createSession(cwd) : SessionManager.inMemory(cwd);
      ({ session } = await create({ cwd, model, thinkingLevel: selected.thinking, modelRuntime: models, settingsManager: settings, resourceLoader: loader,
        sessionManager, tools: [...allowed, ...memoryTools, ...customTools.map(t => t.name)], customTools }));
      lifetime.signal.throwIfAborted();
      hub.attach(workerId, session);
      hub.update(workerId, { metadata: { ...hub.get(workerId).metadata, compaction: "VCC extension loaded", memoryTools } });
      unsubscribe = session.subscribe(event => {
        if (event.type === "tool_execution_start") safeReport(`${name}: ${event.toolName}`);
        if (event.type === "message_start" && event.message?.role === "user") {
          const text = textOf(event.message);
          const receipt = hub.get(workerId).receipts.find(r => r.wireText === text && !deliveries.has(r.id) && r.state !== "cancelled");
          if (receipt) { deliveries.add(receipt.id); intervention++; }
        }
      });
      if (session.model?.id !== selected.model || session.model?.provider !== selected.provider || session.thinkingLevel !== selected.thinking) throw new Error(`Pi changed the ${name} model/thinking selection; stopped.`);
      await session.bindExtensions({ mode: "json" }); lifetime.signal.throwIfAborted();
      accepting = true; hub.update(workerId, { state: "working", activity: "Thinking" }); safeReport(`${name}: working`);
      const request = `${task}${schema ? "\nSubmit the final result with submit_result." : ""}`;
      await session.prompt(assignedSkill ? `/skill:${assignedSkill} ${request}` : request);
      accepting = false;
      await Promise.allSettled([...sends]); lifetime.signal.throwIfAborted();
      if (hub.get(workerId).receipts.some(r => ["sending", "queued"].includes(r.state))) throw new Error("A human instruction remained undelivered. Work is preserved; inspect the retained message before resuming.");
      const message = [...session.messages].reverse().find(m => m.role === "assistant");
      if (!message || ["error", "aborted"].includes(message.stopReason)) throw new Error(`${name}: ${message?.errorMessage || message?.stopReason || "no result"}`);
      if (schema) {
        if (value === undefined || submittedAt !== intervention) throw new Error(`${name}: no current structured result after human intervention. The previous result is not accepted.`);
        if (rejectPassOnFeedback && intervention && value.verdict === "pass") throw new Error("Human review feedback requires repairs or blocked, not silent PASS.");
        return value;
      }
      const text = textOf(message).trim();
      if (!text) throw new Error(`${name}: empty final result.`);
      return text;
    } catch (error) {
      outcome = lifetime.signal.aborted ? "aborted" : "failed";
      hub.update(workerId, { error: error.message || String(error) }); throw error;
    } finally {
      accepting = false;
      signal?.removeEventListener("abort", parentAbort); lifetime.signal.removeEventListener("abort", abortSession);
      unsubscribe();
      try { if (session) await session.extensionRunner.emit({ type: "session_shutdown" }); }
      finally { hub.unregister(workerId, outcome); session?.dispose(); }
      safeReport(`${name}: stopped`);
    }
  }

  // Opening a finished thread never revives it. A follow-up is a NEW read-only
  // investigation and cannot replace the result its parent already consumed.
  hub.readOnlyFollowUp = async (record, question) => {
    if (record.metadata?.producer !== "dev-workflow") throw new Error("This producer has not supplied a follow-up action.");
    await hub.load(record.id);
    if (record.historyError) throw new Error(record.historyError);
    const last = [...record.messages].reverse().find(m => m.role === "assistant");
    let id;
    const completion = run({ cwd: record.metadata.cwd, name: "explorer", task: `Follow-up question: ${question}\nPrior task: ${record.metadata.task}\nPrior final response: ${textOf(last)}\nPrior native transcript: ${record.sessionFile || "not retained"}`,
      metadata: { parentId: record.id, label: `Follow-up · ${record.label}`, task: question }, onRegistered: registered => { id = registered; } });
    completion.catch(() => {}); // Failures are retained in the new child record.
    if (!id) { await completion; throw new Error("Follow-up was not registered."); }
    return { id, completion };
  };
  return run;
}

export function exploreTool(run, report = () => {}, metadata = {}) {
  return { name: "explore", label: "Explorer",
    description: "Delegate one independent, narrowly scoped read-only investigation. Use separate calls for separate scopes. Returns compact evidence, not a transcript.",
    promptSnippet: "Delegate a narrow codebase, web, or other evidence-heavy investigation to an independent Explorer",
    promptGuidelines: [
      "Use explore for every open-ended or input-heavy codebase investigation, web search, or other evidence gathering. Read directly only for known-target implementation work or quick verification.",
      "Give each explore call one explicit independent scope. Call multiple Explorers, in parallel when useful, for separable questions and consume their compact results instead of raw research.",
    ],
    parameters: Type.Object({ task: Type.String() }),
    async execute(_id, { task }, signal, _onUpdate, ctx) {
      const text = await run({ name: "explorer", cwd: ctx.cwd, task, signal, report, metadata: { ...metadata, task, policy: "task" } });
      return toolResult(text.length > explorerResultChars ? `${text.slice(0, explorerResultChars)}\n[Explorer result truncated]` : text);
    } };
}
