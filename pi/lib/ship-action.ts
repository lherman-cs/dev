import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import crypto from "node:crypto";
import { Type, type Static } from "@earendil-works/pi-ai";
import { admitBuildHandoff, handoffFile, snapshotCandidate } from "./ship-handoff.ts";
import { ShipRuntime, type ShipAction, type ShipState } from "./ship-runtime.ts";
import { ShipStore } from "./ship-store.ts";
import { waitForCi } from "./ci-poller.ts";
import { collectGitHubEvidence, ensureDraftPullRequest, mapRequiredContexts, markPullRequestReady, readRequiredContexts, selectExpectedReviewSignals } from "./github-evidence.ts";
import { pushCandidate, rebaseCandidate } from "./ship-git.ts";
import { runShipBuilder, runShipReviewer } from "./ship-workers.ts";
import type { RunWorker } from "./worker.ts";
import { packetHash } from "./final-packet.ts";
import { confirmFinalPacket } from "./ship-ui.ts";
import { reconcileShipTodos } from "./ship-todo.ts";

let activeWait: AbortController | undefined;
export function abortActiveShipWait(): void { activeWait?.abort(); }

const parameters = Type.Object({ invocationId: Type.String({ minLength: 1, maxLength: 200 }), expectedRevision: Type.Integer({ minimum: 0 }), action: Type.Union([Type.Literal("start"), Type.Literal("prepare"), Type.Literal("publish"), Type.Literal("wait"), Type.Literal("audit"), Type.Literal("repair"), Type.Literal("approve"), Type.Literal("ready")]), expectedHead: Type.String({ pattern: "^[0-9a-f]{40,64}$" }) }, { additionalProperties: false });
type Args = Static<typeof parameters>;
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} });
/** The sole model-facing ship mutation surface. It persists completed transitions beside the handoff. */
export function shipActionTool(runWorker?: RunWorker): ToolDefinition<typeof parameters, Record<string, never>, unknown> {
  return { name: "ship_action", label: "Ship action", description: "Advance the fixed dev-ship state machine using an exact invocation, revision, and candidate HEAD.", parameters,
    async execute(_id, args: Args, signal, onUpdate, ctx) {
      const store = new ShipStore(path.dirname(handoffFile(ctx.cwd)));
      const issuedInvocation = store.loadInvocation();
      if (args.invocationId !== issuedInvocation) throw new Error("Ship invocation ID was not issued by the current /dev-ship command.");
      let state = store.load()?.state;
      if (!state || state.invocationId !== issuedInvocation) {
        if (args.action !== "start" || args.expectedRevision !== 0) throw new Error("Start the command-issued ship invocation before requesting another action.");
        const handoff = admitBuildHandoff(ctx.cwd);
        if (args.expectedHead !== handoff.candidate.branch.head) throw new Error("Ship action has a stale candidate HEAD.");
        state = { invocationId: issuedInvocation, revision: 0, phase: "handoff", candidate: handoff.candidate, handoff, repairs: 0, stableKeys: state?.stableKeys ?? [] };
      }
      const sessionId = ctx.sessionManager.getSessionFile() ?? `ship:${ctx.cwd}`;
      const persist = (next: ShipState) => { store.save({ version: 2, state: next, operations: store.load()?.operations ?? [] }); reconcileShipTodos(sessionId, next); };
      const runtime = new ShipRuntime(state, { persist, refresh: current => Promise.resolve(snapshotCandidate(ctx.cwd, current.base.ref, current.remote.name)) });
      const operationId = `${issuedInvocation}:${args.expectedRevision}:${args.action}`;
      const journal = (status: "intent" | "receipt") => {
        const operations = store.load()?.operations ?? [];
        if (operations.some(item => item.id === operationId && item.status === status)) return;
        store.append({ id: operationId, invocationId: issuedInvocation, action: args.action, candidateHead: state!.candidate.branch.head, desiredDigest: crypto.createHash("sha256").update(`${args.action}:${state!.candidate.branch.head}`).digest("hex"), status, recordedAt: Date.now() });
      };
      await runtime.admit({ invocationId: args.invocationId, expectedRevision: args.expectedRevision, expectedCandidate: { ...state.candidate, branch: { ...state.candidate.branch, head: args.expectedHead } }, action: args.action });
      if (args.action === "prepare") {
        let candidate = state.candidate, localChecks = state.localChecks ?? state.handoff.localChecks;
        if (state.phase === "repairing") {
          if (!runWorker || !state.pullRequest || !state.wait) throw new Error("Repair worker inputs are incomplete.");
          const repaired = await runShipBuilder(runWorker, { handoff: state.handoff, candidate, pullRequest: state.pullRequest, failedCi: state.wait, reviewer: state.reviewer ?? null, round: state.repairs as 1 | 2 }, signal);
          candidate = repaired.candidate; localChecks = repaired.localChecks;
          if (repaired.blocker) throw new Error(`Builder blocked: ${repaired.blocker}`);
        }
        const rebased = rebaseCandidate(candidate);
        candidate = snapshotCandidate(candidate.worktree, candidate.base.ref, candidate.remote.name);
        return result(await runtime.complete("prepare", { candidate, localChecks, rewritten: rebased.rewritten }));
      }
      if (args.action === "publish") {
        journal("intent");
        pushCandidate(state.candidate, state.rewritten ?? false);
        const evidence = ensureDraftPullRequest(state.candidate, `Ship ${state.candidate.branch.name}`, `Automated draft for ${state.handoff.approved.plan.path}.`);
        const publishedCandidate = { ...state.candidate, remote: { ...state.candidate.remote, oid: state.candidate.branch.head } };
        const next = await runtime.complete("publish", { candidate: publishedCandidate, pullRequest: evidence.pullRequest, inventory: evidence.inventory });
        journal("receipt"); return result(next);
      }
      if (args.action === "wait") {
        const initial = collectGitHubEvidence(state.candidate), required = mapRequiredContexts(readRequiredContexts(state.candidate), initial.checks);
        const expected = state.handoff.expectedReviewSignals.map(item => `${item.kind}:${item.value}`);
        let latestEvidence = initial;
        const controller = new AbortController(); activeWait = controller;
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        try {
          const outcome = await waitForCi(state.candidate, required.map(check => check.id), {
            observe: async () => { latestEvidence = collectGitHubEvidence(state.candidate); return latestEvidence.checks; },
            observeSignals: async () => selectExpectedReviewSignals(state.handoff.expectedReviewSignals, latestEvidence),
            persistObservation: async (_candidate, checks, observedSignals = []) => {
              const observation = { status: "interrupted" as const, candidate: state!.candidate, requiredCheckIds: required.map(check => check.id), checks, observedSignals, reason: "observing" };
              persist({ ...runtime.snapshot(), wait: observation } as ShipState);
              await onUpdate?.(result(observation));
            },
            persist: () => undefined,
          }, { initialDelayMs: 1_000, maxDelayMs: 30_000, timeoutMs: 30 * 60_000 }, combined, expected);
          return result(await runtime.complete("wait", { wait: outcome }));
        } finally { if (activeWait === controller) activeWait = undefined; }
      }
      if (args.action === "audit") {
        if (!runWorker || !state.pullRequest || state.wait?.status !== "passed") throw new Error("A passed wait result and exact pull request are required for audit.");
        const evidence = collectGitHubEvidence(state.candidate);
        const reviewer = await runShipReviewer(runWorker, { handoff: state.handoff, candidate: state.candidate, pullRequest: evidence.pullRequest, inventory: evidence.inventory }, signal);
        runtime.validateReview(evidence.inventory, reviewer);
        const packet = reviewer.verdict === "PASS" ? { candidate: state.candidate, pullRequest: evidence.pullRequest, localChecks: state.localChecks ?? state.handoff.localChecks, ci: state.wait, inventory: evidence.inventory, reviewer, summary: `Candidate ${state.candidate.branch.head} passed the complete ship audit.`, residualRisks: state.handoff.residualRisks, repairRounds: state.repairs } : undefined;
        return result(await runtime.complete("audit", { pullRequest: evidence.pullRequest, inventory: evidence.inventory, reviewer, ...(packet ? { packet } : {}) }));
      }
      if (args.action === "approve") {
        if (!state.packet) throw new Error("Final packet is not available for approval.");
        const session = ctx.sessionManager.getSessionFile() ?? "interactive";
        const approver = `interactive:${crypto.createHash("sha256").update(session).digest("hex").slice(0, 16)}`;
        const approval = await confirmFinalPacket(state.packet, ctx.hasUI ? ctx.ui : undefined, approver);
        return result(await runtime.complete("approve", { approval }));
      }
      if (args.action === "ready") {
        if (!state.packet || !state.approval || !state.pullRequest) throw new Error("Approved final packet is required before ready-for-review.");
        const live = collectGitHubEvidence(state.candidate);
        if (live.inventory.digest !== state.packet.inventory.digest || live.pullRequest.number !== state.packet.pullRequest.number || packetHash(state.packet) !== state.approval.packetHash) throw new Error("Final evidence drifted after approval.");
        journal("intent");
        if (live.pullRequest.draft) markPullRequestReady(live.pullRequest, state.candidate);
        const next = await runtime.complete("ready", { pullRequest: { ...live.pullRequest, draft: false } });
        journal("receipt"); return result(next);
      }
      return result(await runtime.complete(args.action as ShipAction));
    } };
}
