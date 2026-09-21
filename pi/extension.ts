import { randomUUID } from "node:crypto";
import { humanEditor } from "./lib/human-editor.mjs";
import { createWorkerRunner, exploreTool } from "./lib/worker.mjs";
import { WorkerHub } from "./lib/worker-hub.mjs";
import { WorkerHistory } from "./lib/worker-history.mjs";
import { WorkflowControl } from "./lib/workflow-control.mjs";
import { registerWorkerHubUI } from "./worker-hub-ui.ts";
import { runWorkflow, excludeState } from "./lib/workflow.mjs";

export const explorerOnlyTools = new Set(["web_search", "source_check", "fetch_content", "get_search_content"]);
const mainReadTools = new Set(["read", "grep", "find", "ls", "explore", "lsp_diagnostics", "ask_user_question", "ask_human"]);
export const workflowError = (error, phase, target = "") => `${error.message}\n\nProgress is preserved. After resolving the issue, resume with /dev-${phase}${target ? ` ${target}` : ""}.`;

export default function (pi) {
  const hub = new WorkerHub();
  const run = createWorkerRunner({ hub });
  const hubUI = registerWorkerHubUI(pi, hub);
  let active, closed = false;
  pi.on("session_start", (_event, ctx) => {
    hub.interactive = !!ctx.hasUI;
    try {
      if (ctx.sessionManager?.getSessionId && !hub.history) {
        hub.history = new WorkerHistory({ cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(),
          sessionDir: ctx.sessionManager.getSessionDir(), parentFile: ctx.sessionManager.getSessionFile() });
        hub.restore(hub.history.records());
      }
    } catch (error) { hub.historyFailure = error; ctx.ui.notify(`Agent history unavailable: ${error.message}`, "error"); }
    hubUI.setContext(ctx);
  });

  // A small producer seam: other extensions may supply sessions and controls.
  // This never adds spawning, model policy or scheduling to Agent Hub.
  const offProducer = pi.events?.on("dev:agent-hub", request => {
    try {
      if (request.action === "register") {
        const id = hub.register(request.worker);
        request.reply?.({ id });
      }
      else if (request.action === "update") hub.update(request.id, request.patch);
      else if (request.action === "finish") hub.unregister(request.id, request.state);
    } catch (error) { request.reply?.({ error: error.message }); }
  });
  pi.registerTool(exploreTool(run));
  pi.on("tool_call", event => {
    if (explorerOnlyTools.has(event.toolName)) return { block: true, reason: `Delegate ${event.toolName} to one or more narrowly scoped explore calls.` };
    if (active && !active.paused && !mainReadTools.has(event.toolName)) return {
      block: true, reason: "The workflow currently owns this worktree. Main remains available for discussion and read-only exploration. Use /dev-pause or /dev-stop before competing edits or commands.",
    };
  });

  for (const phase of ["spec", "plan"]) pi.registerCommand(`dev-${phase}`, {
    description: `Invoke dev-${phase} in the current conversation`,
    handler: async (args, ctx) => {
      if (active) { ctx.ui.notify("Stop the automated workflow before changing its spec/plans.", "warning"); return; }
      hubUI.setContext(ctx);
      try {
        await excludeState({ cwd: ctx.cwd, exec: (program, argv) => pi.exec(program, argv, { cwd: ctx.cwd }) });
        pi.sendUserMessage(`/skill:dev-${phase}${args ? ` ${args}` : ""}`, { expandPromptTemplates: true });
      } catch (error) { ctx.ui.notify(error.message, "error"); }
    },
  });

  for (const phase of ["build", "prepare", "review", "ship"]) pi.registerCommand(`dev-${phase}`, {
    description: `Run ${phase} for an approved project or spec path`,
    handler: async (args, ctx) => {
      if (active) { ctx.ui.notify("A workflow is running. Alt+A → F2 has pause, continue and stop controls.", "warning"); return; }
      if (ctx.isIdle && !ctx.isIdle()) { ctx.ui.notify("Let the Main turn finish or stop it before starting a writing workflow.", "warning"); return; }
      if (hub.historyFailure) { ctx.ui.notify(`Restore history storage before starting: ${hub.historyFailure.message}`, "error"); return; }
      const workflowId = randomUUID();
      const control = new WorkflowControl({ onChange: () => hub.setWorkflow({ label: `dev-${phase}`, workflowId, control }),
        canResume: () => !ctx.isIdle || ctx.isIdle() });
      active = control; hubUI.setContext(ctx); control.publish();
      const request = (title, run) => ctx.hasUI
        ? hub.request({ ownerId: "main", title, run }, control.signal)
        : Promise.reject(new Error("Human approval requires interactive Pi."));
      const h = {
        cwd: ctx.cwd, signal: control.signal, control,
        rawExec(program, argv) { return pi.exec(program, argv, { cwd: this.cwd, signal: this.signal }); },
        exec(program, argv) { return control.operation(program, argv, () => this.rawExec(program, argv)); },
        sleep: ms => control.sleep(ms),
        async delegate(name, task, skill, schema, options = {}) {
          await control.checkpoint(`Running ${options.metadata?.label || name}`);
          const { metadata = {}, ...delegateOptions } = options;
          const purpose = metadata.task || (name === "review" ? "Review the exact candidate against approved acceptance criteria"
            : name === "ship" ? "Summarize the approved candidate for the pull request"
              : name === "build_retry" ? "Resolve only the assigned rebase conflicts" : task);
          const label = metadata.label || (name === "review" ? "Reviewer · exact candidate" : name === "ship" ? "Finalizer · approved PR summary" : name);
          return run({ cwd: this.cwd, name, task, skill, schema, signal: this.signal, ...delegateOptions,
            rejectPassOnFeedback: name === "review",
            metadata: { ...metadata, task: purpose, label, workflowId, parentId: "main", policy: metadata.contract ? "contract" : "task" },
            report: text => { if (!closed) { try { ctx.ui.setStatus("dev-worker", text); } catch { /* closed runtime */ } } } });
        },
        outcome(contract, outcome) {
          const worker = hub.list().filter(r => r.metadata?.workflowId === workflowId && r.metadata?.contract === contract && r.metadata?.parentId === "main").at(-1);
          if (worker) hub.update(worker.id, { outcome });
        },
        select: (title, choices) => request(title, (context, signal) => context.ui.select(title, choices, { signal })),
        confirm: (title, message) => request(title, async (context, signal) => {
          if (!context.hasUI) throw new Error("Human approval requires interactive Pi.");
          const choice = await context.ui.select(`${title}\n${message}`, ["Cancel", "Confirm"], { signal });
          return choice === "Confirm";
        }),
        async review(title, markdown, repairs) {
          if (!ctx.hasUI) throw new Error("Human review requires interactive Pi.");
          return request(title, async (context, signal) => {
            pi.sendMessage({ customType: "dev-workflow", content: markdown, display: true }, { triggerTurn: false });
            if (repairs) {
              pi.sendMessage({ customType: "dev-workflow", content: repairs.map(r => `## ${r.title}\n${r.reason}\n\n${r.goal}\n\n${(r.evidence || []).join("\n")}\n\nChecks: ${(r.checks || []).join(", ")}`).join("\n\n"), display: true }, { triggerTurn: false });
              const chosen = new Set();
              while (true) {
                signal.throwIfAborted();
                const labels = repairs.map((r, i) => `${i + 1}. ${chosen.has(r.key) ? "[x]" : "[ ]"} ${r.title}`);
                const selected = await context.ui.select(title, ["Cancel", ...labels, "Apply selected"], { signal });
                if (selected === "Apply selected") return { action: "repairs", keys: [...chosen] };
                if (!selected || selected === "Cancel") return { action: "cancel" };
                const key = repairs[labels.indexOf(selected)].key;
                chosen.has(key) ? chosen.delete(key) : chosen.add(key);
              }
            }
            const action = await context.ui.select(title, ["Cancel", "Request changes", "Approve"], { signal });
            if (action === "Approve") return { action: "approve" };
            if (action === "Request changes") {
              const feedback = await humanEditor(context, "Review feedback", "", signal);
              if (feedback?.trim()) return { action: "feedback", feedback };
            }
            return { action: "cancel" };
          });
        },
        report(content) {
          control.report(content);
          if (!closed) pi.sendMessage({ customType: "dev-workflow", content, display: true }, { triggerTurn: false });
        },
      };
      try { await runWorkflow(h, phase, args); control.finish("completed", "Workflow run finished; inspect its outcome in Main."); }
      catch (error) {
        control.finish(control.signal.aborted ? "stopped" : "failed", workflowError(error, phase, args));
        if (!closed) ctx.ui.notify(workflowError(error, phase, args), control.signal.aborted ? "info" : "error");
      } finally {
        if (!closed) ctx.ui.setStatus("dev-worker", undefined);
        if (active === control) active = undefined;
      }
    },
  });
  pi.registerCommand("dev-pause", { description: "Pause at the next controller operation boundary", handler: async (_args, ctx) => active ? active.pause() : ctx.ui.notify("No active workflow.", "info") });
  pi.registerCommand("dev-continue", { description: "Revalidate and continue a paused workflow", handler: async (_args, ctx) => {
    try { if (!active || !await active.resume()) ctx.ui.notify("No workflow is paused yet.", "info"); }
    catch (error) { ctx.ui.notify(error.message, "error"); }
  } });
  pi.registerCommand("dev-stop", { description: "Cancel the workflow and all of its owned work", handler: async (_args, ctx) => active ? active.stop() : ctx.ui.notify("No workflow is running. Alt+A → F2 stops an individual agent.", "info") });
  pi.on("session_shutdown", async () => {
    closed = true; active?.stop(); hubUI.dispose();
    await hub.stopAll(); offProducer?.(); hub.dispose();
  });
}
