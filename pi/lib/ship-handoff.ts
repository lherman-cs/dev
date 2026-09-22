import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@earendil-works/pi-ai";
import { buildHandoffSchema, type BuildHandoff, type CandidateIdentity } from "./ship-contracts.ts";
import { ShipStore } from "./ship-store.ts";

const handoffParameters = Type.Object({
  specPath: Type.String({ minLength: 1 }),
  planPath: Type.String({ minLength: 1 }),
  baseRef: Type.String({ minLength: 1 }),
  remote: Type.Optional(Type.String({ minLength: 1 })),
  completedOutcomes: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { minItems: 1, maxItems: 100 }),
  localChecks: Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 200 }), command: Type.String({ minLength: 1, maxLength: 2_000 }),
    status: Type.Union([Type.Literal("passed"), Type.Literal("failed"), Type.Literal("not_run"), Type.Literal("proof_gap")]), evidence: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
  }, { additionalProperties: false }), { maxItems: 100 }),
  residualRisks: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 100 }),
  unresolvedDecisions: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 100 }),
  expectedReviewSignals: Type.Array(Type.Object({
    kind: Type.Union([Type.Literal("author"), Type.Literal("check")]),
    value: Type.String({ minLength: 1, maxLength: 500 }),
  }, { additionalProperties: false }), { maxItems: 100 }),
}, { additionalProperties: false });
export type BuildHandoffRequest = Static<typeof handoffParameters>;

const runGit = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sha256 = (file: string): string => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const textResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function approvedArtifact(cwd: string, value: string): { path: string; sha256: string } {
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const absolute = path.resolve(cwd, value);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(absolute).isFile()) throw new Error(`Approved artifact must be a repository file: ${value}`);
  return { path: relative, sha256: sha256(absolute) };
}

/** Reads all Git identities live so a build handoff cannot be fabricated from chat context. */
export function snapshotCandidate(cwd: string, baseRef: string, remote = "origin"): CandidateIdentity {
  const root = runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const worktree = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const branch = runGit(cwd, ["branch", "--show-current"]);
  if (!branch) throw new Error("Build handoff requires a named branch, not detached HEAD.");
  const head = runGit(cwd, ["rev-parse", "HEAD"]);
  const remoteUrl = runGit(cwd, ["remote", "get-url", remote]);
  const baseOid = runGit(cwd, ["rev-parse", `${remote}/${baseRef}`]);
  let remoteOid: string | undefined;
  try { remoteOid = runGit(cwd, ["rev-parse", `refs/remotes/${remote}/${branch}`]); } catch { remoteOid = undefined; }
  return { repository: { root, coordinate: remoteUrl }, worktree, branch: { name: branch, head }, base: { ref: baseRef, oid: baseOid }, remote: { name: remote, url: remoteUrl, ...(remoteOid ? { oid: remoteOid } : {}) } }; 
}

export function handoffFile(cwd: string): string { return runGit(cwd, ["rev-parse", "--git-path", "dev-ship/handoff.json"]); }
export function recordBuildHandoff(cwd: string, request: BuildHandoffRequest, now = Date.now()): BuildHandoff {
  if (runGit(cwd, ["status", "--porcelain=v1"])) throw new Error("Build handoff requires a clean worktree after the final coherent commit.");
  const remote = request.remote ?? "origin";
  const handoff: BuildHandoff = {
    version: 2, candidate: snapshotCandidate(cwd, request.baseRef, remote),
    approved: { spec: approvedArtifact(cwd, request.specPath), plan: approvedArtifact(cwd, request.planPath) },
    completedOutcomes: request.completedOutcomes, localChecks: request.localChecks, residualRisks: request.residualRisks,
    unresolvedDecisions: request.unresolvedDecisions, expectedReviewSignals: request.expectedReviewSignals, recordedAt: now,
  };
  new ShipStore(path.dirname(handoffFile(cwd))).saveHandoff(handoff);
  return handoff;
}
export function loadBuildHandoff(cwd: string): BuildHandoff {
  return new ShipStore(path.dirname(handoffFile(cwd))).loadHandoff();
}
/** Admission is intentionally live: persisted state is evidence, never authority over Git. */
export function admitBuildHandoff(cwd: string): BuildHandoff {
  const handoff = loadBuildHandoff(cwd);
  if (handoff.unresolvedDecisions.length) throw new Error("Build handoff has unresolved human decisions.");
  if (runGit(cwd, ["status", "--porcelain=v1"])) throw new Error("Worktree drifted after build handoff.");
  const candidate = snapshotCandidate(cwd, handoff.candidate.base.ref, handoff.candidate.remote.name);
  if (!same(candidate, handoff.candidate)) throw new Error("Git identity drifted after build handoff.");
  for (const artifact of Object.values(handoff.approved)) {
    const absolute = path.resolve(cwd, artifact.path);
    if (!fs.existsSync(absolute) || sha256(absolute) !== artifact.sha256) throw new Error(`Approved artifact drifted: ${artifact.path}`);
  }
  return handoff;
}

export function buildHandoffTool(): ToolDefinition<typeof handoffParameters, Record<string, never>, unknown> {
  return { name: "build_handoff", label: "Build handoff", description: "Atomically record the clean, HEAD-bound approved build handoff for dev-ship.", parameters: handoffParameters,
    async execute(_id, args, _signal, _update, ctx) { return textResult(recordBuildHandoff(ctx.cwd, args)); } };
}

export { buildHandoffSchema };
