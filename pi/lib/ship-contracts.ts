import { Type, type Static } from "@earendil-works/pi-ai";

const text = (maxLength = 4_000) => Type.String({ minLength: 1, maxLength });
const oid = Type.String({ pattern: "^[0-9a-f]{40,64}$" });

/** Shared, closed contracts for the fixed dev-ship runtime. */
export const repositoryIdentitySchema = Type.Object({
  root: text(),
  coordinate: text(500),
}, { additionalProperties: false });
export const branchIdentitySchema = Type.Object({ name: text(500), head: oid });
export const baseIdentitySchema = Type.Object({ ref: text(500), oid });
export const remoteIdentitySchema = Type.Object({ name: text(100), url: text(2_000), oid });
export const candidateIdentitySchema = Type.Object({
  repository: repositoryIdentitySchema,
  worktree: text(),
  branch: branchIdentitySchema,
  base: baseIdentitySchema,
  remote: remoteIdentitySchema,
}, { additionalProperties: false });
export const approvedArtifactSchema = Type.Object({ path: text(), sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }) }, { additionalProperties: false });
export const localCheckSchema = Type.Object({
  name: text(200), command: text(2_000), status: Type.Union([Type.Literal("passed"), Type.Literal("failed"), Type.Literal("not_run"), Type.Literal("proof_gap")]),
  evidence: Type.Optional(text(2_000)),
}, { additionalProperties: false });
export const buildHandoffSchema = Type.Object({
  version: Type.Literal(1),
  candidate: candidateIdentitySchema,
  approved: Type.Object({ spec: approvedArtifactSchema, plan: approvedArtifactSchema }, { additionalProperties: false }),
  completedOutcomes: Type.Array(text(2_000), { minItems: 1, maxItems: 100 }),
  localChecks: Type.Array(localCheckSchema, { maxItems: 100 }),
  residualRisks: Type.Array(text(2_000), { maxItems: 100 }),
  unresolvedDecisions: Type.Array(text(2_000), { maxItems: 100 }),
  recordedAt: Type.Number({ minimum: 0 }),
}, { additionalProperties: false });
export type RepositoryIdentity = Static<typeof repositoryIdentitySchema>;
export type CandidateIdentity = Static<typeof candidateIdentitySchema>;
export type ApprovedArtifact = Static<typeof approvedArtifactSchema>;
export type LocalCheck = Static<typeof localCheckSchema>;
export type BuildHandoff = Static<typeof buildHandoffSchema>;

export const pullRequestIdentitySchema = Type.Object({ number: Type.Integer({ minimum: 1 }), url: text(2_000), state: Type.Union([Type.Literal("OPEN"), Type.Literal("CLOSED")]), draft: Type.Boolean(), head: branchIdentitySchema, base: baseIdentitySchema }, { additionalProperties: false });
export const ciCheckSchema = Type.Object({ id: text(500), name: text(500), head: oid, state: text(100), conclusion: Type.Union([text(100), Type.Null()]) }, { additionalProperties: false });
export const inventoryItemSchema = Type.Object({ id: text(500), kind: Type.Union([Type.Literal("check"), Type.Literal("review"), Type.Literal("thread"), Type.Literal("comment")]), head: oid, state: text(100), digest: Type.String({ pattern: "^[0-9a-f]{64}$" }) }, { additionalProperties: false });
export const inventorySchema = Type.Object({ candidate: candidateIdentitySchema, items: Type.Array(inventoryItemSchema), digest: Type.String({ pattern: "^[0-9a-f]{64}$" }) }, { additionalProperties: false });
export const reviewerDispositionSchema = Type.Object({ itemId: text(500), disposition: Type.Union([Type.Literal("actionable"), Type.Literal("resolved"), Type.Literal("outdated"), Type.Literal("dismissed"), Type.Literal("non_actionable")]), rationale: text() }, { additionalProperties: false });
export const reviewerResultSchema = Type.Object({ verdict: Type.Union([Type.Literal("PASS"), Type.Literal("REPAIRS"), Type.Literal("BLOCKED")]), candidate: candidateIdentitySchema, inventoryDigest: Type.String({ pattern: "^[0-9a-f]{64}$" }), dispositions: Type.Array(reviewerDispositionSchema), findings: Type.Array(Type.Object({ key: text(200), evidence: Type.Array(text(2_000)), acceptanceChecks: Type.Array(text(2_000)) }, { additionalProperties: false })), blocker: Type.Union([text(), Type.Null()]) }, { additionalProperties: false });
export const waitOutcomeSchema = Type.Object({ status: Type.Union([Type.Literal("passed"), Type.Literal("failed"), Type.Literal("stale_timeout"), Type.Literal("cancelled"), Type.Literal("interrupted")]), candidate: candidateIdentitySchema, checks: Type.Array(ciCheckSchema) }, { additionalProperties: false });
export const approvalIdentitySchema = Type.Object({ packetHash: Type.String({ pattern: "^[0-9a-f]{64}$" }), approvedAt: Type.Number({ minimum: 0 }), approver: text(500) }, { additionalProperties: false });
export const finalPacketSchema = Type.Object({ candidate: candidateIdentitySchema, pullRequest: pullRequestIdentitySchema, localChecks: Type.Array(localCheckSchema), ci: waitOutcomeSchema, inventory: inventorySchema, reviewer: reviewerResultSchema, summary: text(), residualRisks: Type.Array(text()), repairRounds: Type.Integer({ minimum: 0, maximum: 2 }) }, { additionalProperties: false });
export type PullRequestIdentity = Static<typeof pullRequestIdentitySchema>;
export type CiCheck = Static<typeof ciCheckSchema>;
export type Inventory = Static<typeof inventorySchema>;
export type ReviewerResult = Static<typeof reviewerResultSchema>;
export type WaitOutcome = Static<typeof waitOutcomeSchema>;
export type FinalPacket = Static<typeof finalPacketSchema>;
