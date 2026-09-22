import { Type, type Static } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { candidateIdentitySchema, localCheckSchema, reviewerResultSchema, type BuildHandoff, type CandidateIdentity, type Inventory, type PullRequestIdentity, type ReviewerResult, type WaitOutcome } from "./ship-contracts.ts";
import { collectGitHubEvidence, fetchExactGitHubObject } from "./github-evidence.ts";
import type { RunWorker } from "./worker.ts";

export const builderResultSchema = Type.Object({
  candidate: candidateIdentitySchema,
  localChecks: Type.Array(localCheckSchema),
  repairedKeys: Type.Array(Type.String({ minLength: 1, maxLength: 200 })),
  blocker: Type.Union([Type.String({ minLength: 1, maxLength: 4_000 }), Type.Null()]),
}, { additionalProperties: false });
export type BuilderResult = Static<typeof builderResultSchema>;

const evidenceParameters = Type.Object({
  repository: Type.String({ minLength: 1, maxLength: 2_000 }),
  pullRequest: Type.Integer({ minimum: 1 }),
  candidate: candidateIdentitySchema,
  kind: Type.Union([Type.Literal("comment"), Type.Literal("thread"), Type.Literal("check"), Type.Literal("failed_log")]),
  id: Type.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function candidateEvidenceTool(expected: CandidateIdentity, pullRequest: PullRequestIdentity): ToolDefinition<typeof evidenceParameters> {
  return {
    name: "ship_candidate_evidence", label: "Candidate evidence",
    description: "Fetch one bounded GitHub object only after revalidating the exact ship candidate and pull request.", parameters: evidenceParameters,
    async execute(_id, args) {
      if (args.repository !== expected.repository.coordinate || args.pullRequest !== pullRequest.number || canonical(args.candidate) !== canonical(expected)) throw new Error("Evidence request does not match the scoped candidate.");
      const live = collectGitHubEvidence(expected);
      if (live.pullRequest.number !== pullRequest.number) throw new Error("Live pull request drifted.");
      const object = fetchExactGitHubObject(args.id, expected.branch.head, args.kind === "failed_log" ? 12_000 : 4_000);
      return { content: [{ type: "text", text: canonical({ kind: args.kind, object }) }], details: {} };
    },
  };
}

export interface RepairPayload { handoff: BuildHandoff; candidate: CandidateIdentity; pullRequest: PullRequestIdentity; failedCi: WaitOutcome; reviewer: ReviewerResult; round: 1 | 2 }
export interface ReviewPayload { handoff: BuildHandoff; candidate: CandidateIdentity; pullRequest: PullRequestIdentity; inventory: Inventory }

export async function runShipBuilder(run: RunWorker, payload: RepairPayload, signal?: AbortSignal): Promise<BuilderResult> {
  return run({ cwd: payload.candidate.worktree, name: payload.round === 1 ? "build" : "escalated_builder", skill: "dev-ship-builder", task: canonical(payload), schema: builderResultSchema, ...(signal ? { signal } : {}), tools: ["read", "grep", "find", "ls", "bash", "edit", "write", "lsp_diagnostics", "lsp_fix"], metadata: { phase: "ship", label: `Ship repair ${payload.round}` } });
}

export async function runShipReviewer(run: RunWorker, payload: ReviewPayload, signal?: AbortSignal): Promise<ReviewerResult> {
  const evidence = candidateEvidenceTool(payload.candidate, payload.pullRequest);
  return run({ cwd: payload.candidate.worktree, name: "review", skill: "dev-review", task: canonical(payload), schema: reviewerResultSchema, ...(signal ? { signal } : {}), scopedTools: [evidence], metadata: { phase: "ship", label: "Ship audit" } });
}
