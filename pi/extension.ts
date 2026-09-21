import { safeText } from "./lib/worker-transcript.ts";
import { humanEditor } from "./lib/human-editor.ts";
import { Text } from "@earendil-works/pi-tui";
import { createWorkerRunner, exploreTool } from "./lib/worker.ts";
import { WorkerHub, isActive } from "./lib/worker-hub.ts";
import { WorkerHistory } from "./lib/worker-history.ts";
import { WorkflowControl, WorkflowPaused } from "./lib/workflow-control.ts";
import { registerWorkerHubUI } from "./worker-hub-ui.ts";
import { runWorkflow, excludeState } from "./lib/workflow.ts";

export const explorerOnlyTools = new Set(["web_search", "source_check", "fetch_content", "get_search_content"]);
const mainReaders = new Set(["read", "grep", "find", "ls", "explore", "vcc_recall", "ask_user_question"]);
export const workflowError = (error, phase, target = "") => `${error.message}\n\nProgress is preserved. After resolving the issue, resume with /dev-${phase}${target ? ` ${target}` : ""}.`;

// Optional constructors keep integration tests on the same registration path.
export default function (pi, dependencies = {}) {
  let ctx, history, active, lastControl, foregroundPrompts = 0, closing = false;
  const lifetime = new AbortController();
  const warn = error => { if (!closing) ctx?.ui.notify(`Agent Hub: ${error.message || error}`, "warning"); };
  const hub = dependencies.hub || new WorkerHub({ onError: warn });
  const run = (dependencies.createWorkerRunner || createWorkerRunner)({ hub, getHistory: () => history,
    askHuman: ({ ownerId, question, choices }, signal) => hub.request({ ownerId, title: question, run: async context => {
      if (!context.hasUI) throw new Error("Human response requires interactive Pi.");
      return choices?.length ? context.ui.select(question, ["Cancel", ...choices], { signal }).then(value => value === "Cancel" ? undefined : value) : humanEditor(context, question, "", signal);
    } }, signal),
  });
  hub.onRelated = (record, text) => run.related(record, text);
  const control = () => active || lastControl;
  const writesOwned = () => !!active || hub.list().some(r => isActive(r) && !r.metadata.readOnly);
  const ownershipMessage = "Main is read-only while a controller or writing child owns this worktree. Alt+A opens that agent. /dev-pause stops before the next safe step; /dev-stop cancels running work. Wait for Paused/Stopped before editing in Main.";
  let hubUI;
  const respond = async (questionId) => {
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
    const index = choices.indexOf(selected);
    if (index >= 0) await questions[index].answer(ctx);
  };
  hubUI = (dependencies.registerWorkerHubUI || registerWorkerHubUI)(pi, hub, {
    control, respond,
    resume: () => continueWorkflow(),
  });
  const audit = (kind, data) => {
    if (!closing) try { pi.appendEntry?.("dev-controller-event", { kind, at: Date.now(), ...data }); } catch (error) { warn(error); }
  };
  pi.registerEntryRenderer?.("dev-controller-event", (entry, _opts, theme) => new Text(
    theme.fg(entry.data.code || entry.data.error ? "error" : "muted", safeText(`${entry.data.phase || "Workflow"} · ${entry.data.kind}\n${entry.data.text || entry.data.command || ""}${entry.data.stdout ? `\nstdout:\n${entry.data.stdout}` : ""}${entry.data.stderr ? `\nstderr:\n${entry.data.stderr}` : ""}${entry.data.error ? `\n${entry.data.error}` : ""}`)), 0, 0));

  pi.on("session_start", async (_event, nextCtx) => {
    ctx = nextCtx;
    history = new WorkerHistory(ctx.sessionManager, warn);
    hub.setHistory(history); hubUI.setContext(ctx); hubUI.setWorkflow();
    await history.restore(hub, lifetime.signal);
  });
  // Other extensions may register externally-owned native sessions. The small
  // adapter is parent-scoped, not global discovery or a new spawning tool.
  const unlisten = pi.events?.on("dev:worker-hub", request => {
    const parentId = ctx?.sessionManager.getSessionId();
    if (closing || !parentId || request?.sessionId !== parentId || typeof request.receive !== "function") return;
    const valid = () => { if (closing || ctx?.sessionManager.getSessionId() !== parentId) throw new Error("Parent session changed."); };
    request.receive({
      createSessionManager(cwd, metadata) { valid(); return history.create(cwd, metadata); },
      register(record) {
        valid();
        if (!record.id || !record.session) throw new Error("Register an id and an externally-owned AgentSession.");
        hub.register({ ...record, metadata: { ...record.metadata, external: true } });
        return {
          update(patch) { valid(); hub.update(record.id, patch); },
          finish(state = "completed") { valid(); hub.unregister(record.id, state); },
        };
      },
    });
  });

  pi.registerTool(exploreTool(run));
  pi.on("tool_call", event => {
    if (explorerOnlyTools.has(event.toolName)) return { block: true, reason: `Delegate ${event.toolName} to one or more narrowly scoped explore calls.` };
    if (writesOwned() && !mainReaders.has(event.toolName)) return { block: true, reason: ownershipMessage };
  });
  pi.on("user_bash", () => writesOwned() ? { result: { output: ownershipMessage, exitCode: 1, cancelled: false, truncated: false } } : undefined);
  // Do not open a controller behind a main-turn tool/question dialog.
  pi.on("ui_prompt_start", () => { foregroundPrompts++; });
  pi.on("ui_prompt_end", () => { foregroundPrompts = Math.max(0, foregroundPrompts - 1); });
  for (const event of ["session_before_switch", "session_before_fork"]) pi.on(event, () => {
    if (active || run.hasActive() || hub.list().some(isActive)) {
      ctx?.ui.notify("Stop active work before changing the parent session. Histories and drafts will be preserved.", "warning");
      return { cancel: true };
    }
  });

  for (const phase of ["spec", "plan"]) pi.registerCommand(`dev-${phase}`, {
    description: `Invoke dev-${phase} in the current conversation`,
    handler: async (args, nextCtx) => {
      ctx = nextCtx;
      if (writesOwned()) { ctx.ui.notify(ownershipMessage, "warning"); return; }
      hubUI.setContext(ctx); hubUI.setWorkflow(`dev-${phase}`);
      try {
        await excludeState({ cwd: ctx.cwd, exec: (program, argv) => pi.exec(program, argv, { cwd: ctx.cwd }) });
        pi.sendUserMessage(`/skill:dev-${phase}${args ? ` ${args}` : ""}`, { expandPromptTemplates: true });
      } catch (error) { ctx.ui.notify(error.message, "error"); }
    },
  });

  async function continueWorkflow() {
    if (active || !lastControl || !ctx) return;
    try {
      await lastControl.verifyResume();
      await start(lastControl.phase, lastControl.target, ctx);
    } catch (error) { ctx.ui.notify(error.message, "warning"); }
  }

  async function start(phase, args, nextCtx) {
    ctx = nextCtx;
    if (active || !ctx.isIdle() || ctx.hasPendingMessages?.() || foregroundPrompts > 0 || hub.list().some(r => isActive(r) && !r.metadata.readOnly)) {
      ctx.ui.notify("Finish or stop active writing work and Main's turn before starting another controller.", "warning"); return;
    }
    try { history?.ensureParent(); } catch (error) { ctx.ui.notify(`Cannot persist the parent session: ${error.message}`, "error"); return; }
    const current = new WorkflowControl(phase, args, () => hubUI.refresh());
    active = current; lastControl = current;
    hubUI.setContext(ctx); hubUI.setWorkflow(`dev-${phase}`);
    const report = text => { current.update(text); audit("progress", { phase, text }); };
    const ask = (title, show) => {
      if (!ctx.hasUI) return Promise.reject(new Error("Human approval requires interactive Pi."));
      audit("needs human", { phase, text: title });
      return current.ask(title, show);
    };
    const h = {
      cwd: ctx.cwd, signal: current.signal, control: current,
      rawExec(program, argv) { return pi.exec(program, argv, { cwd: this.cwd }); },
      checkpoint: activity => current.checkpoint(activity),
      async exec(program, argv) {
        current.signal.throwIfAborted();
        const command = `${program} ${argv.join(" ")}`;
        audit("command start", { phase, command });
        try {
          const result = await pi.exec(program, argv, { cwd: this.cwd, signal: this.signal });
          audit("command end", { phase, command, code: result.code, stdout: result.stdout, stderr: result.stderr });
          current.signal.throwIfAborted(); return result;
        } catch (error) {
          audit("command interrupted", { phase, command, error: error.message });
          throw error;
        }
      },
      async delegate(name, task, skill, schema, options = {}) {
        current.checkpoint();
        const { metadata = {}, ...rest } = options;
        let id;
        const result = await run({ cwd: this.cwd, name, task, skill, schema, ...rest,
          signal: this.signal, metadata: { phase, owner: "workflow", ...metadata },
          onStarted: value => { id = value; }, report: text => current.update(text),
        });
        this.lastWorkerId = id; return result;
      },
      workerOutcome: (id, outcome) => { if (id) hub.update(id, { outcome }); },
      select: (title, choices) => ask(title, () => ctx.ui.select(title, ["Cancel", ...choices], { signal: current.signal }).then(v => v === "Cancel" ? undefined : v)),
      confirm: (title, message) => ask(title, async () => (await ctx.ui.select(`${title}\n${message}`, ["Cancel", "Confirm"], { signal: current.signal })) === "Confirm"),
      review: (title, markdown, repairs) => ask(title, async () => {
        pi.sendMessage({ customType: "dev-workflow", content: markdown, display: true }, { triggerTurn: false });
        if (repairs) {
          pi.sendMessage({ customType: "dev-workflow", content: repairs.map(r => `## ${r.title}\n${r.reason}\n\n${r.goal}\n\n${(r.evidence || []).join("\n")}\n\nChecks: ${(r.checks || []).join(", ")}`).join("\n\n"), display: true }, { triggerTurn: false });
          const chosen = new Set();
          while (true) {
            const labels = repairs.map((r, i) => `${i + 1}. ${chosen.has(r.key) ? "[x]" : "[ ]"} ${r.title}`);
            const selected = await ctx.ui.select(title, ["Cancel", ...labels, "Apply selected"], { signal: current.signal });
            current.signal.throwIfAborted();
            if (selected === "Apply selected") return { action: "repairs", keys: [...chosen] };
            if (!selected || selected === "Cancel") return { action: "cancel" };
            const key = repairs[labels.indexOf(selected)].key;
            chosen.has(key) ? chosen.delete(key) : chosen.add(key);
          }
        }
        const action = await ctx.ui.select(title, ["Cancel", "Request changes", "Approve exact candidate"], { signal: current.signal });
        current.signal.throwIfAborted();
        if (action === "Approve exact candidate") return { action: "approve" };
        if (action === "Request changes") {
          const feedback = await humanEditor(ctx, "Review feedback", "", current.signal);
          if (feedback?.trim()) return { action: "feedback", feedback };
        }
        return { action: "cancel" };
      }),
      report,
    };
    let failure;
    try { await (dependencies.runWorkflow || runWorkflow)(h, phase, args); }
    catch (error) { failure = error; if (!closing) ctx.ui.notify(workflowError(error, phase, args), current.signal.aborted ? "info" : "warning"); }
    finally {
      if (failure instanceof WorkflowPaused) {
        try { await current.capturePause(); }
        catch (error) { warn(`Pause state preserved but fast continuation disabled: ${error.message}`); }
      }
      current.finish(failure); audit(current.state, { phase, text: `${current.activity}\n${current.resumeCommand}` });
      if (active === current) active = undefined;
      hubUI.refresh();
    }
  }
  for (const phase of ["build", "prepare", "review", "ship"]) pi.registerCommand(`dev-${phase}`, {
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
