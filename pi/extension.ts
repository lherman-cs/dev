import { createWorkerRunner, exploreTool } from "./lib/worker.mjs";
import { WorkerHub } from "./lib/worker-hub.mjs";
import { registerWorkerHubUI } from "./worker-hub-ui.ts";
import { runWorkflow, excludeState } from "./lib/workflow.mjs";

export const explorerOnlyTools = new Set(["web_search", "source_check", "fetch_content", "get_search_content"]);
export const workflowError = (error, phase, target = "") => `${error.message}\n\nProgress is preserved. After resolving the issue, resume with /dev-${phase}${target ? ` ${target}` : ""}.`;

export default function (pi) {
  const hub = new WorkerHub();
  const run = createWorkerRunner({ hub });
  const hubUI = registerWorkerHubUI(pi, hub);
  let active;

  // Agent Hub is a session surface, not a controller surface. Explorers spawned
  // from ordinary Spec/Plan/main turns use the same registry and navigation as
  // workflow-owned builders/reviewers.
  pi.on("session_start", (_event, ctx) => {
    hubUI.setContext(ctx);
    hubUI.setWorkflow("session");
  });

  pi.registerTool(exploreTool(run));
  pi.on("tool_call", event => explorerOnlyTools.has(event.toolName)
    ? { block: true, reason: `Delegate ${event.toolName} to one or more narrowly scoped explore calls.` }
    : undefined);

  for (const phase of ["spec", "plan"]) {
    pi.registerCommand(`dev-${phase}`, {
      description: `Invoke dev-${phase} in the current conversation`,
      handler: async (args, ctx) => {
        if (active) { ctx.ui.notify("Stop the automated workflow before changing its spec/plans.", "warning"); return; }
        hubUI.setContext(ctx);
        hubUI.setWorkflow(`dev-${phase}`);
        try {
          await excludeState({ cwd: ctx.cwd, exec: (program, argv) => pi.exec(program, argv, { cwd: ctx.cwd }) });
          pi.sendUserMessage(`/skill:dev-${phase}${args ? ` ${args}` : ""}`, { expandPromptTemplates: true });
        } catch (error) { ctx.ui.notify(error.message, "error"); }
      },
    });
  }

  for (const phase of ["build", "prepare", "review", "ship"]) {
    pi.registerCommand(`dev-${phase}`, {
      description: `Run ${phase} for an approved project or spec path`,
      handler: async (args, ctx) => {
        if (active) { ctx.ui.notify("A workflow is running. Use /dev-stop to cancel.", "warning"); return; }
        const controller = new AbortController(); active = controller;
        hubUI.setContext(ctx);
        hubUI.setWorkflow(`dev-${phase}`);
        const h = {
          cwd: ctx.cwd, signal: controller.signal,
          exec(program, argv) { return pi.exec(program, argv, { cwd: this.cwd, signal: this.signal }); },
          delegate(name, task, skill, schema, options = {}) {
            const contract = /(?:Execution contract: .*\/|Conflicted files:\n)([PR]\d+)(?:\.toon)?/.exec(task)?.[1];
            const label = contract ? `${name}:${contract}` : undefined;
            const { metadata: extraMetadata = {}, ...delegateOptions } = options;
            return run({
              cwd: this.cwd, name, task, skill, schema, signal: this.signal,
              ...delegateOptions,
              metadata: { label, phase, task: task.split("\n", 1)[0]?.slice(0, 140), ...extraMetadata },
              report: text => { try { ctx.ui.setStatus("dev-worker", text); } catch { /* session closed */ } },
            });
          },
          select: (title, choices) => ctx.ui.select(title, choices),
          confirm: (title, message) => ctx.hasUI ? ctx.ui.confirm(title, message) : Promise.reject(new Error("Human approval requires interactive Pi.")),
          async review(title, markdown, repairs) {
            if (!ctx.hasUI) throw new Error("Human review requires interactive Pi.");
            pi.sendMessage({ customType: "dev-workflow", content: markdown, display: true }, { triggerTurn: false });
            if (repairs) {
              pi.sendMessage({ customType: "dev-workflow", content: repairs.map(r => `## ${r.title}\n${r.reason}\n\n${r.goal}\n\n${(r.evidence || []).join("\n")}\n\nChecks: ${(r.checks || []).join(", ")}`).join("\n\n"), display: true }, { triggerTurn: false });
              const chosen = new Set();
              while (true) {
                const labels = repairs.map((r, i) => `${i + 1}. ${chosen.has(r.key) ? "[x]" : "[ ]"} ${r.title}`);
                const selected = await ctx.ui.select(title, [...labels, "Apply selected", "Cancel"]);
                if (selected === "Apply selected") return { action: "repairs", keys: [...chosen] };
                if (!selected || selected === "Cancel") return { action: "cancel" };
                const key = repairs[labels.indexOf(selected)].key;
                chosen.has(key) ? chosen.delete(key) : chosen.add(key);
              }
            }
            const action = await ctx.ui.select(title, ["Approve", "Request changes", "Cancel"]);
            if (action === "Approve") return { action: "approve" };
            if (action === "Request changes") {
              const feedback = await ctx.ui.editor("Review feedback", "");
              if (feedback?.trim()) return { action: "feedback", feedback };
            }
            return { action: "cancel" };
          },
          report: content => pi.sendMessage({ customType: "dev-workflow", content, display: true }, { triggerTurn: false }),
        };
        try { await runWorkflow(h, phase, args); }
        catch (error) { ctx.ui.notify(workflowError(error, phase, args), "error"); }
        finally {
          ctx.ui.setStatus("dev-worker", undefined);
          if (active === controller) active = undefined;
          hubUI.setWorkflow("session");
        }
      },
    });
  }

  pi.registerCommand("dev-stop", { description: "Cancel the workflow and its native Pi worker", handler: async () => active?.abort() });
  pi.on("session_shutdown", () => { active?.abort(); hubUI.dispose(); hub.dispose(); });
}
