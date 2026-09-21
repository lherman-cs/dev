import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { role } from "./roles.mjs";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const readers = ["read", "grep", "find", "ls"];
const toolResult = text => ({ content: [{ type: "text", text }], details: {} });

// One fresh native Pi session. No subprocess protocol, agent registry, or scheduler.
export function createWorkerRunner({ runtime, create = createAgentSession } = {}) {
  async function run({ cwd, name, task, skill, schema, signal = new AbortController().signal, report = () => {}, system = "", tools }) {
    signal.throwIfAborted();
    const selected = role(name);
    const models = runtime || await ModelRuntime.create();
    const model = models.getModel(selected.provider, selected.model);
    if (!model) throw new Error(`Pi does not list ${selected.provider}/${selected.model}; no model fallback is allowed.`);
    if (!models.hasConfiguredAuth(selected.provider)) throw new Error(`No login for ${selected.provider}. Use Pi /login; no model/provider fallback was attempted.`);
    const explorer = name === "explorer";
    const readonly = explorer || name === "review";
    const settings = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
      // Do not re-load ambient UI, MCP servers, or this controller in children.
      additionalExtensionPaths: [path.join(packageDir, "node_modules/pi-web-access/dist/index.js"),
        ...(!readonly ? [path.join(packageDir, "node_modules/@narumitw/pi-lsp/dist/index.ts"), path.join(packageDir, "node_modules/@narumitw/pi-chrome-devtools/dist/index.ts")] : [])],
      additionalSkillPaths: skill ? [path.join(packageDir, "skills", skill)] : [],
      appendSystemPrompt: [system, ...(explorer ? ["Answer only the assigned read-only question. Return Conclusion / Evidence / Uncertainty, not the research transcript."] : [])].filter(Boolean),
    });
    await loader.reload();
    const errors = loader.getExtensions().errors;
    if (errors.length) throw new Error(`Worker extension load failed: ${errors.map(e => `${e.path}: ${e.error}`).join("; ")}`);
    if (skill && !loader.getSkills().skills.some(s => s.name === skill)) throw new Error(`Missing worker skill ${skill}`);
    let value;
    const customTools = explorer ? [] : [exploreTool(run, report)];
    if (schema) customTools.push({ name: "submit_result", label: "Submit result", description: "Submit the final result in the required schema.", parameters: schema,
      async execute(_id, args) { value = args; return toolResult("Result recorded."); } });
    const allowed = tools || [...readers, ...(!readonly ? ["bash"] : []), ...(!readonly ? ["edit", "write", "lsp_diagnostics", "lsp_fix", "chrome_devtools_load", "chrome_devtools_list_pages", "chrome_devtools_select_page", "chrome_devtools_navigate", "chrome_devtools_evaluate", "chrome_devtools_screenshot"] : []), "web_search", "fetch_content", "get_search_content"];
    const { session } = await create({ cwd, model, thinkingLevel: selected.thinking, modelRuntime: models,
      settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd),
      tools: [...allowed, ...customTools.map(t => t.name)], customTools });
    const abort = () => { void session.abort(); };
    const unsubscribe = session.subscribe(event => {
      if (event.type === "tool_execution_start") report(`${name}: ${event.toolName}`);
    });
    try {
      if (session.model?.id !== selected.model || session.model?.provider !== selected.provider || session.thinkingLevel !== selected.thinking) throw new Error(`Pi changed the ${name} model/thinking selection; stopped.`);
      await session.bindExtensions({ mode: "json" });
      signal.addEventListener("abort", abort, { once: true });
      signal.throwIfAborted();
      report(`${name}: working`);
      const request = `${task}${schema ? "\nSubmit the final result with submit_result." : ""}`;
      await session.prompt(skill ? `/skill:${skill} ${request}` : request);
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
    } finally {
      signal.removeEventListener("abort", abort);
      unsubscribe();
      try { await session.extensionRunner.emit({ type: "session_shutdown" }); } finally { session.dispose(); }
      report(`${name}: stopped`);
    }
  }
  return run;
}

// Universal, bounded, read-only exploration; not an arbitrary subagent tool.
export function exploreTool(run, report = () => {}) {
  return { name: "explore", label: "Explorer",
    description: "Delegate one narrow read-only investigation. Use for substantial research; keep trivial known-path lookups local. Returns compact evidence, not a transcript.",
    parameters: Type.Object({ task: Type.String() }),
    async execute(_id, { task }, signal, _onUpdate, ctx) {
      const text = await run({ name: "explorer", cwd: ctx.cwd, task, signal, report });
      return toolResult(text.length > 8000 ? `${text.slice(0, 8000)}\n[Explorer result truncated]` : text);
    } };
}
