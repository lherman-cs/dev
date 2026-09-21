import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { role } from "./roles.mjs";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const readers = ["read", "grep", "find", "ls"];
const explorerResultChars = 4000;
const toolResult = text => ({ content: [{ type: "text", text }], details: {} });

// One fresh native Pi session. No subprocess protocol, agent registry, or scheduler.
// Every child created here is registered in the session-wide WorkerHub so the
// human gets one consistent Agent Hub whether or not a /dev-* controller exists.
export function createWorkerRunner({ runtime, create = createAgentSession, hub } = {}) {
  if (!hub?.register || !hub?.unregister || !hub?.nextId) throw new Error("createWorkerRunner requires a WorkerHub so child sessions cannot be hidden.");
  let modelsPromise;
  async function run({ cwd, name, task, skill, schema, signal = new AbortController().signal, report = () => {}, system = "", tools, metadata = {} }) {
    signal.throwIfAborted();
    const selected = role(name);
    const models = runtime || await (modelsPromise ||= ModelRuntime.create());
    const model = models.getModel(selected.provider, selected.model);
    if (!model) throw new Error(`Pi does not list ${selected.provider}/${selected.model}; no model fallback is allowed.`);
    if (!models.hasConfiguredAuth(selected.provider)) throw new Error(`No login for ${selected.provider}. Use Pi /login; no model/provider fallback was attempted.`);
    const explorer = name === "explorer";
    const readonly = explorer || name === "review";
    const assignedSkill = explorer ? "dev-explore" : skill;
    const settings = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
      // Do not re-load ambient UI, MCP servers, or this controller in children.
      additionalExtensionPaths: [path.join(packageDir, "node_modules/pi-web-access/dist/index.js"),
        ...(!readonly ? [path.join(packageDir, "node_modules/@narumitw/pi-lsp/dist/index.ts"), path.join(packageDir, "node_modules/@narumitw/pi-chrome-devtools/dist/index.ts")] : [])],
      additionalSkillPaths: assignedSkill ? [path.join(packageDir, "skills", assignedSkill)] : [],
      appendSystemPrompt: [system].filter(Boolean),
    });
    await loader.reload();
    const errors = loader.getExtensions().errors;
    if (errors.length) throw new Error(`Worker extension load failed: ${errors.map(e => `${e.path}: ${e.error}`).join("; ")}`);
    if (assignedSkill && !loader.getSkills().skills.some(s => s.name === assignedSkill)) throw new Error(`Missing worker skill ${assignedSkill}`);
    let value;
    const customTools = explorer ? [] : [exploreTool(run, report)];
    if (schema) customTools.push({ name: "submit_result", label: "Submit result", description: "Submit the final result in the required schema.", parameters: schema,
      async execute(_id, args) { value = args; return toolResult("Result recorded."); } });
    const allowed = tools || [...readers, ...(!readonly ? ["bash"] : []), ...(!readonly ? ["edit", "write", "lsp_diagnostics", "lsp_fix", "chrome_devtools_load", "chrome_devtools_list_pages", "chrome_devtools_select_page", "chrome_devtools_navigate", "chrome_devtools_evaluate", "chrome_devtools_screenshot"] : []), ...(explorer ? ["web_search", "source_check", "fetch_content", "get_search_content"] : [])];
    const { session } = await create({ cwd, model, thinkingLevel: selected.thinking, modelRuntime: models,
      settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd),
      tools: [...allowed, ...customTools.map(t => t.name)], customTools });
    const workerId = hub.nextId(name);
    const workerMetadata = {
      task: String(metadata.task || task || "").split("\n", 1)[0].slice(0, 140),
      ...metadata,
    };
    let workerState = "completed";
    let unsubscribe = () => {};
    const abort = () => { void session.abort(); };
    try {
      hub.register({
        id: workerId,
        label: metadata.label || workerId,
        role: name,
        model: selected.model,
        thinking: selected.thinking,
        session,
        metadata: workerMetadata,
      });
      unsubscribe = session.subscribe(event => {
        if (event.type === "tool_execution_start") report(`${name}: ${event.toolName}`);
      });
      if (session.model?.id !== selected.model || session.model?.provider !== selected.provider || session.thinkingLevel !== selected.thinking) throw new Error(`Pi changed the ${name} model/thinking selection; stopped.`);
      await session.bindExtensions({ mode: "json" });
      signal.addEventListener("abort", abort, { once: true });
      signal.throwIfAborted();
      report(`${name}: working`);
      const request = `${task}${schema ? "\nSubmit the final result with submit_result." : ""}`;
      await session.prompt(assignedSkill ? `/skill:${assignedSkill} ${request}` : request);
      signal.throwIfAborted();
      const message = [...session.messages].reverse().find(m => m.role === "assistant");
      if (!message || ["error", "aborted"].includes(message.stopReason)) throw new Error(`${name}: ${message?.errorMessage || message?.stopReason || "no result"}`);
      if (schema) {
        if (value === undefined) throw new Error(`${name}: no structured result was submitted.`);
        return value;
      }
      const text = message.content.filter(p => p.type === "text").map(p => p.text).join("\n").trim();
      if (!text) throw new Error(`${name}: empty final result.`);
      return text;
    } catch (error) {
      workerState = signal.aborted || session.messages.some(message => message.stopReason === "aborted") ? "aborted" : "failed";
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      unsubscribe();
      try { await session.extensionRunner.emit({ type: "session_shutdown" }); } finally {
        hub.unregister(workerId, workerState);
        session.dispose();
      }
      report(`${name}: stopped`);
    }
  }
  return run;
}

// Universal, bounded, read-only exploration; not an arbitrary subagent tool.
export function exploreTool(run, report = () => {}) {
  return { name: "explore", label: "Explorer",
    description: "Delegate one independent, narrowly scoped read-only investigation. Use separate calls for separate scopes. Returns compact evidence, not a transcript.",
    promptSnippet: "Delegate a narrow codebase, web, or other evidence-heavy investigation to an independent Explorer",
    promptGuidelines: [
      "Use explore for every open-ended or input-heavy codebase investigation, web search, or other evidence gathering. Read directly only for known-target implementation work or quick verification.",
      "Give each explore call one explicit independent scope. Call multiple Explorers, in parallel when useful, for separable questions and consume their compact results instead of raw research.",
    ],
    parameters: Type.Object({ task: Type.String() }),
    async execute(_id, { task }, signal, _onUpdate, ctx) {
      const text = await run({ name: "explorer", cwd: ctx.cwd, task, signal, report, metadata: { task } });
      return toolResult(text.length > explorerResultChars ? `${text.slice(0, explorerResultChars)}\n[Explorer result truncated]` : text);
    } };
}
