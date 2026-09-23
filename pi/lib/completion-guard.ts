import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Type, type Static } from "@earendil-works/pi-ai";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RunWorker } from "./worker.ts";

const entryType = "dev-completion-guard";
const finishParams = Type.Object({
  outcome: Type.Union([Type.Literal("complete"), Type.Literal("blocked")]),
  summary: Type.String({ minLength: 1, maxLength: 4000 }),
  evidence: Type.String({ minLength: 1, maxLength: 8000 }),
}, { additionalProperties: false });
const verdictSchema = Type.Object({
  verdict: Type.Union([Type.Literal("complete"), Type.Literal("blocked"), Type.Literal("missing")]),
  explanation: Type.String({ minLength: 1, maxLength: 4000 }),
  missing: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { maxItems: 20 }),
}, { additionalProperties: false });
type Verdict = Static<typeof verdictSchema>;
type Task = { id: number; subject: string; status: string; description?: string };
type State = {
  id: string; session: string; request: string; skill: string; clarifications: string[];
  baseline: number[]; members: number[]; tasks: Task[]; revision: number;
  accepted?: "complete" | "blocked"; paused?: string; interrupted?: boolean;
};
const isState = (value: unknown): value is State => !!value && typeof value === "object" &&
  typeof (value as State).id === "string" && typeof (value as State).request === "string" &&
  Array.isArray((value as State).members) && Array.isArray((value as State).tasks);
const snapshot = (details: unknown): Task[] | undefined => {
  if (!details || typeof details !== "object") return;
  const data = details as { tasks?: unknown; error?: unknown };
  if (data.error || !Array.isArray(data.tasks) || !data.tasks.every(t => t && typeof t.id === "number" && typeof t.status === "string" && typeof t.subject === "string")) return;
  return data.tasks as Task[];
};
function branchTasks(ctx: ExtensionContext): Task[] {
  for (const entry of ctx.sessionManager.getBranch().reverse()) {
    if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolName !== "todo") continue;
    const tasks = snapshot(entry.message.details);
    if (tasks) return tasks;
  }
  return [];
}
function gitEvidence(cwd: string): string {
  try {
    const status = execFileSync("git", ["status", "--short"], { cwd, encoding: "utf8", timeout: 5000 });
    const log = execFileSync("git", ["log", "-5", "--oneline"], { cwd, encoding: "utf8", timeout: 5000 });
    const diff = execFileSync("git", ["diff", "HEAD", "--"], { cwd, encoding: "utf8", timeout: 5000, maxBuffer: 512 * 1024 });
    return `Status:\n${status}\nRecent commits:\n${log}\nWorking diff (bounded):\n${diff.slice(0, 20000)}`;
  } catch { return "Git evidence unavailable; assess only evidence that can be inspected."; }
}

/** One guarded foreground request, backed by native branch entries and todo snapshots. */
export function registerCompletionGuard(pi: ExtensionAPI, run: RunWorker, hasAsyncWork: () => boolean): {
  activate(request: string, skill: string, ctx: ExtensionContext): void;
  cancel(): void;
} {
  let state: State | undefined;
  let ctx: ExtensionContext | undefined;
  let pending: string | undefined;
  let revision = 0;
  let stagnant = 0;
  let assessmentFailures = 0;
  let lastWork = "";
  let lastGap = "";
  let acceptedEvidence = "";
  const save = () => { if (state) pi.appendEntry(entryType, state); };
  const deliver = (text: string) => {
    try { pi.sendMessage({ customType: "dev-finish-result", content: text, display: true }, { triggerTurn: true, deliverAs: "steer" }); }
    catch (error) {
      if (state) { delete state.accepted; state.paused = `Assessment delivery failed: ${String(error)}`; save(); }
      ctx?.ui.notify(`Incomplete pause: ${state?.paused ?? String(error)}`, "warning");
    }
  };
  const restore = (next: ExtensionContext) => {
    ctx = next; pending = undefined; stagnant = 0; assessmentFailures = 0; lastWork = ""; lastGap = ""; acceptedEvidence = "";
    const entry = next.sessionManager.getBranch().reverse().find(e => e.type === "custom" && e.customType === entryType);
    state = entry && entry.type === "custom" && isState(entry.data) ? { ...entry.data, interrupted: true } : undefined;
    if (state?.session !== next.sessionManager.getSessionId()) state = undefined;
    if (state) delete state.accepted;
    revision = state?.revision ?? 0;
    if (state && !state.paused) { save(); next.ui.notify("Completion guard restored an interrupted request; reconcile before finishing.", "warning"); }
  };
  pi.on("session_start", (_event, next) => restore(next));
  const cancel = () => { if (state) { state = { ...state, paused: "Cancelled by user" }; save(); } pending = undefined; };
  pi.on("session_before_switch", cancel);
  pi.on("session_before_fork", cancel);
  pi.on("agent_settled", () => {
    if (state?.accepted && !state.paused) { state.paused = "Finished"; save(); }
  });
  pi.on("agent_end", event => {
    const last = [...event.messages].reverse().find(message => message.role === "assistant");
    if (last?.role === "assistant" && last.stopReason === "aborted") cancel();
  });
  const activate = (request: string, skill: string, next: ExtensionContext) => {
    ctx = next;
    if (state && !state.paused && !state.accepted) {
      // A new user request supersedes the former request; never revive its late assessor.
      cancel();
    }
    const tasks = branchTasks(next);
    state = { id: randomUUID(), session: next.sessionManager.getSessionId(), request, skill,
      clarifications: [], baseline: tasks.map(t => t.id), members: [], tasks, revision: ++revision };
    stagnant = 0; assessmentFailures = 0; lastWork = ""; lastGap = ""; acceptedEvidence = ""; save();
  };
  pi.on("input", event => {
    if (event.source !== "interactive" && event.source !== "rpc") return;
    if (!state || state.paused || /^\/skill:dev-(build|ship)(?:\s|$)/.test(event.text)) return;
    if (/^(?:cancel|stop)\b/i.test(event.text.trim())) { cancel(); return; }
    state.clarifications.push(event.text); delete state.accepted;
    state.revision = ++revision; stagnant = 0; lastGap = ""; save();
  });
  pi.on("tool_result", event => {
    if (!state || state.paused || event.isError) return;
    if (event.toolName === "finish") return;
    const work = JSON.stringify([event.toolName, event.input, event.content, event.details]);
    if (work === lastWork) return;
    lastWork = work;
    if (event.toolName === "todo") {
      const tasks = snapshot(event.details);
      if (!tasks) return;
      for (const task of tasks) if (!state.baseline.includes(task.id) && !state.members.includes(task.id)) state.members.push(task.id);
      state.tasks = tasks;
    }
    delete state.accepted; acceptedEvidence = "";
    state.revision = ++revision; stagnant = 0; lastGap = ""; save();
  });
  pi.registerTool({ name: "finish", label: "Finish", parameters: finishParams,
    description: "Propose a terminal outcome for the guarded request. Complete: summarize satisfied outcomes and cite concise proof. Blocked: name the exact unavailable decision/access/evidence and why autonomous progress is unsafe. Returns immediately; independent assessment is delivered asynchronously.",
    async execute(_id, args: Static<typeof finishParams>, _signal, _onUpdate, toolCtx) {
      const current = state;
      if (!current || current.paused || current.accepted || current.session !== toolCtx.sessionManager.getSessionId()) throw new Error("No active guarded request.");
      if (pending) throw new Error("An independent finish assessment is already running.");
      if (hasAsyncWork()) throw new Error("Wait for known asynchronous evidence work to deliver before proposing a terminal outcome.");
      const token = randomUUID(); pending = token;
      const atRevision = current.revision;
      const atEvidence = gitEvidence(toolCtx.cwd);
      const evidenceHash = createHash("sha256").update(atEvidence).digest("hex");
      const tasks = current.tasks.filter(t => current.members.includes(t.id));
      const skillText = readFileSync(fileURLToPath(new URL(`../skills/dev-${current.skill}/SKILL.md`, import.meta.url)), "utf8");
      const prompt = `Independently assess this terminal proposal. Original request (not replaceable by the proposal):\n${current.request}\nInvoked skill contract:\n${skillText}\nUser clarifications: ${JSON.stringify(current.clarifications)}\nRelevant todo tasks (claims, not proof): ${JSON.stringify(tasks)}\nProposed ${args.outcome}: ${args.summary}\nProposed evidence: ${args.evidence}\n${atEvidence}\nCheck current evidence and the original requirements, including omissions from todos and tests. A blocked verdict requires an actual unavailable consequential input or authority. Return complete, blocked, or missing with concrete reasons. Submit with submit_result.`;
      void run({ name: "assessor", cwd: toolCtx.cwd, task: prompt, skill: "dev-finish", schema: verdictSchema,
        tools: ["read", "grep", "find", "ls"], metadata: { task: "Independent terminal assessment", label: "Finish assessor" } })
        .then((verdict: Verdict) => {
          if (pending !== token || state?.id !== current.id || state.session !== current.session || state.paused || ctx?.sessionManager.getSessionId() !== current.session) return;
          pending = undefined;
          if (state.revision !== atRevision || createHash("sha256").update(gitEvidence(toolCtx.cwd)).digest("hex") !== evidenceHash) {
            deliver("Finish assessment superseded by newer work or instructions. Reconcile and submit a fresh finish proposal.");
            return;
          } // New evidence or instructions superseded this result.
          if (verdict.verdict === args.outcome && verdict.missing.length === 0) {
            state.accepted = args.outcome; acceptedEvidence = evidenceHash;
            state.interrupted = false; assessmentFailures = 0; save();
            deliver(`Independent finish confirmed: ${verdict.explanation}`);
          } else {
            const gap = JSON.stringify([args, verdict.verdict, verdict.missing]);
            state.interrupted = false; state.revision = ++revision;
            if (gap === lastGap) state.paused = `Repeated identical finish gap without intervening work: ${verdict.explanation}`;
            lastGap = gap; stagnant = 0; save();
            deliver(state.paused ? `Incomplete pause: ${state.paused}` : `Finish not accepted. ${verdict.explanation}\n${verdict.missing.join("\n")}`);
          }
        }).catch(error => {
          if (pending !== token || state?.id !== current.id || ctx?.sessionManager.getSessionId() !== current.session) return;
          pending = undefined; state.revision = ++revision;
          if (++assessmentFailures >= 2) state.paused = `Independent assessment unavailable after bounded retries: ${String(error)}`;
          save();
          deliver(state.paused ? `Incomplete pause: ${state.paused}` : `Finish assessment failed; not accepted: ${String(error)}. Reconcile and retry.`);
        });
      return { content: [{ type: "text" as const, text: "Terminal outcome proposed; independent assessment is pending. This is provisional, not acceptance." }], details: { token } };
    },
  });
  pi.on("agent_before_settle", event => {
    if (event.outcome === "aborted") { cancel(); return; }
    if (state?.accepted && acceptedEvidence && ctx && createHash("sha256").update(gitEvidence(ctx.cwd)).digest("hex") !== acceptedEvidence) {
      delete state.accepted; acceptedEvidence = ""; state.revision = ++revision; save();
    }
    if (event.outcome === "error" && state && !state.accepted && !state.paused) {
      state.paused = "Model or resource failure interrupted the guarded request; completion is unverified.";
      save(); ctx?.ui.notify(`Incomplete pause: ${state.paused}`, "warning"); return;
    }
    if (!state || state.paused || state.accepted || state.session !== ctx?.sessionManager.getSessionId() || event.outcome !== "completed" || !event.context.canContinue) return;
    if (pending || hasAsyncWork()) return; // The known completion event wakes the owner; do not poll.
    const tasks = state.tasks.filter(t => state!.members.includes(t.id) && t.status !== "completed" && t.status !== "deleted");
    if (++stagnant > 2) {
      state.paused = `No productive progress after repeated endings. ${tasks.length ? `Outstanding: ${tasks.map(t => t.subject).join(", ")}` : "Terminal proof remains unaccepted."}`;
      save(); ctx?.ui.notify(`Incomplete pause: ${state.paused}`, "warning"); return;
    }
    const obligation = tasks.length ? `Continue the original request. Outstanding tasks: ${tasks.map(t => `${t.id}: ${t.subject}`).join("; ")}. Do not settle at a partial milestone.`
      : "All known tasks are closed or absent. Submit finish with evidence for every original requirement; do not infer completion from the checklist.";
    return { entries: [{ type: "custom_message" as const, customType: "dev-completion-continuation", content: obligation, display: true }], continue: true };
  });
  return { activate, cancel };
}
