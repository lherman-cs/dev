import { role, type ResolvedRole } from "./roles.ts";
import type { ApprovalIdentity, BuildHandoff, CandidateIdentity, FinalPacket, Inventory, LocalCheck, PullRequestIdentity, ReviewerResult, WaitOutcome } from "./ship-contracts.ts";

export type ShipAction = "start" | "prepare" | "publish" | "wait" | "audit" | "repair" | "approve" | "ready";
export type ShipPhase = "handoff" | "prepared" | "published" | "waiting" | "audited" | "repairing" | "approved" | "ready" | "stopped";
export interface PendingShipWorker { operationId: string; action: "prepare" | "audit"; role: "Builder" | "Reviewer"; reservedRevision: number; candidate: CandidateIdentity; }
export interface ShipWorkerFailure { operationId: string; action: "prepare" | "audit"; role: "Builder" | "Reviewer"; message: string; recordedAt: number; }
export interface ShipState { invocationId: string; revision: number; phase: ShipPhase; candidate: CandidateIdentity; handoff: BuildHandoff; repairs: number; stableKeys: string[]; rewritten?: boolean; pullRequest?: PullRequestIdentity; localChecks?: LocalCheck[]; wait?: WaitOutcome; inventory?: Inventory; reviewer?: ReviewerResult; packet?: FinalPacket; approval?: ApprovalIdentity; pendingWorker?: PendingShipWorker; workerFailure?: ShipWorkerFailure; }
export interface ShipActionRequest { invocationId: string; expectedRevision: number; expectedCandidate: CandidateIdentity; action: ShipAction; }
export interface ShipRuntimeDependencies { persist(state: ShipState): Promise<void> | void; refresh(candidate: CandidateIdentity): Promise<CandidateIdentity>; }
const transitions: Record<ShipPhase, readonly ShipAction[]> = { handoff: ["start", "prepare"], prepared: ["publish"], published: ["wait"], waiting: ["audit", "repair"], audited: ["repair", "approve"], repairing: ["prepare"], approved: ["ready"], ready: [], stopped: [] };
const sameCandidate = (a: CandidateIdentity, b: CandidateIdentity) => JSON.stringify(a) === JSON.stringify(b);
/** A closed, persisted state machine. Callers perform side effects only after admit succeeds. */
export class ShipRuntime {
  private state: ShipState;
  private readonly deps: ShipRuntimeDependencies;
  constructor(state: ShipState, deps: ShipRuntimeDependencies) { this.state = state; this.deps = deps; }
  snapshot(): Readonly<ShipState> { return structuredClone(this.state); }
  async admit(request: ShipActionRequest): Promise<ShipState> {
    if (this.state.pendingWorker) throw new Error(`Ship ${this.state.pendingWorker.role} ${this.state.pendingWorker.operationId} is still running.`);
    if (request.invocationId !== this.state.invocationId || request.expectedRevision !== this.state.revision) throw new Error("Stale ship action.");
    if (!sameCandidate(request.expectedCandidate, this.state.candidate)) throw new Error("Stale candidate identity.");
    if (!transitions[this.state.phase].includes(request.action)) throw new Error(`Cannot ${request.action} while ship state is ${this.state.phase}.`);
    if (request.action === "repair" && this.state.wait?.status !== "failed" && this.state.reviewer?.verdict !== "REPAIRS") throw new Error("Repair requires failed CI or a Reviewer REPAIRS verdict.");
    if (request.action === "approve" && this.state.reviewer?.verdict !== "PASS") throw new Error("Approval requires a Reviewer PASS verdict.");
    const live = await this.deps.refresh(this.state.candidate);
    if (!sameCandidate(live, this.state.candidate)) { const stopped = { ...this.state, candidate: live, phase: "stopped" as const }; delete stopped.approval; await this.replace(stopped); throw new Error("Candidate drifted; automatic shipping stopped."); }
    return this.snapshot() as ShipState;
  }
  builderRole(): ResolvedRole { return role(this.state.repairs === 1 ? "escalated_builder" : "build"); }
  async reserveWorker(operationId: string, action: "prepare" | "audit", roleName: "Builder" | "Reviewer"): Promise<ShipState> {
    if (this.state.pendingWorker) throw new Error(`Ship ${this.state.pendingWorker.role} ${this.state.pendingWorker.operationId} is still running.`);
    if (!transitions[this.state.phase].includes(action)) throw new Error(`Cannot reserve ${action} while ship state is ${this.state.phase}.`);
    if ((action === "prepare") !== (roleName === "Builder")) throw new Error("Ship worker role does not match its action.");
    const pendingWorker: PendingShipWorker = { operationId, action, role: roleName, reservedRevision: this.state.revision, candidate: structuredClone(this.state.candidate) };
    const next = { ...this.state, pendingWorker }; delete next.workerFailure;
    return this.replace(next);
  }
  async completeWorker(operationId: string, patch: Partial<ShipState>): Promise<ShipState> {
    const pending = this.requirePending(operationId);
    const next = { ...this.state }; delete next.pendingWorker; this.state = next;
    return this.complete(pending.action, patch);
  }
  async failWorker(operationId: string, error: unknown, recordedAt = Date.now()): Promise<ShipState> {
    const pending = this.requirePending(operationId);
    const next: ShipState = { ...this.state, phase: "stopped", workerFailure: { operationId, action: pending.action, role: pending.role, message: error instanceof Error ? error.message : String(error), recordedAt } };
    delete next.pendingWorker; delete next.approval;
    return this.replace(next);
  }
  validateReview(inventory: Inventory, review: ReviewerResult): void {
    if (!sameCandidate(inventory.candidate, review.candidate) || inventory.digest !== review.inventoryDigest) throw new Error("Reviewer result does not match the live inventory.");
    const expected = new Set(inventory.items.map(item => item.id)), actual = review.dispositions.map(item => item.itemId);
    if (actual.length !== expected.size || new Set(actual).size !== actual.length || actual.some(id => !expected.has(id))) throw new Error("Reviewer must dispose exactly every inventory item.");
    if (review.verdict === "REPAIRS") {
      if (!review.findings.length) throw new Error("A REPAIRS verdict requires typed findings.");
      const keys = review.findings.map(finding => finding.key);
      if (new Set(keys).size !== keys.length || review.findings.some(finding => !finding.evidence.length || !finding.acceptanceChecks.length)) throw new Error("Repair findings require unique stable keys, evidence, and acceptance checks.");
      if (keys.some(key => this.state.stableKeys.includes(key))) throw new Error("A repaired finding returned; automatic repair convergence stopped.");
    }
  }
  async complete(action: ShipAction, patch: Partial<ShipState> = {}): Promise<ShipState> {
    const phase: Record<ShipAction, ShipPhase> = { start: "handoff", prepare: "prepared", publish: "published", wait: "waiting", audit: "audited", repair: "repairing", approve: "approved", ready: "ready" };
    if (action === "repair" && this.state.repairs >= 2) throw new Error("The global two-round repair limit is exhausted.");
    const repairs = action === "repair" ? this.state.repairs + 1 : this.state.repairs;
    if (action === "audit" && patch.inventory && patch.reviewer) this.validateReview(patch.inventory, patch.reviewer);
    const newKeys = action === "audit" && patch.reviewer?.verdict === "REPAIRS" ? patch.reviewer.findings.map(finding => finding.key) : [];
    const candidateChanged = patch.candidate && !sameCandidate(patch.candidate, this.state.candidate);
    const next: ShipState = { ...this.state, ...patch, repairs, stableKeys: [...new Set([...this.state.stableKeys, ...newKeys])], phase: phase[action] };
    if (candidateChanged && action !== "publish") { delete next.pullRequest; delete next.wait; delete next.inventory; delete next.reviewer; delete next.packet; delete next.approval; }
    return this.replace(next);
  }
  private requirePending(operationId: string): PendingShipWorker {
    const pending = this.state.pendingWorker;
    if (!pending || pending.operationId !== operationId || this.state.revision !== pending.reservedRevision + 1 || !sameCandidate(this.state.candidate, pending.candidate)) throw new Error("Stale ship worker completion.");
    return pending;
  }
  private async replace(next: ShipState): Promise<ShipState> { this.state = { ...next, revision: this.state.revision + 1 }; await this.deps.persist(this.snapshot()); return this.snapshot() as ShipState; }
}
