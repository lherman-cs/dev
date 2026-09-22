import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BuildHandoff } from "./ship-contracts.ts";
import type { ShipState } from "./ship-runtime.ts";

export interface OperationRecord {
  id: string;
  invocationId: string;
  action: string;
  candidateHead: string;
  desiredDigest: string;
  status: "intent" | "receipt";
  recordedAt: number;
}

export interface ShipSnapshot {
  version: 2;
  state: ShipState;
  operations: OperationRecord[];
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const oid = (value: unknown): value is string => text(value) && /^[0-9a-f]{40,64}$/.test(value);

export function validateBuildHandoff(value: unknown): BuildHandoff {
  if (!object(value) || (value['version'] !== 1 && value['version'] !== 2) || !object(value['candidate']) || !object(value['approved'])) throw new Error("Build handoff schema is invalid.");
  const candidate = value['candidate'];
  if (!object(candidate['repository']) || !text(candidate['repository']['root']) || !text(candidate['repository']['coordinate']) || !text(candidate['worktree']) || !object(candidate['branch']) || !text(candidate['branch']['name']) || !oid(candidate['branch']['head']) || !object(candidate['base']) || !text(candidate['base']['ref']) || !oid(candidate['base']['oid']) || !object(candidate['remote']) || !text(candidate['remote']['name']) || !text(candidate['remote']['url'])) throw new Error("Build handoff schema is invalid.");
  if (!Array.isArray(value['completedOutcomes']) || value['completedOutcomes'].length === 0 || !value['completedOutcomes'].every(text) || !Array.isArray(value['localChecks']) || !Array.isArray(value['residualRisks']) || !Array.isArray(value['unresolvedDecisions']) || typeof value['recordedAt'] !== "number") throw new Error("Build handoff schema is invalid.");
  if (value['version'] === 1) return { ...value, version: 2, expectedReviewSignals: [] } as unknown as BuildHandoff;
  if (!Array.isArray(value['expectedReviewSignals'])) throw new Error("Build handoff schema is invalid.");
  return value as unknown as BuildHandoff;
}

export function validateShipSnapshot(value: unknown): ShipSnapshot {
  if (!object(value) || value['version'] !== 2 || !object(value['state']) || !Array.isArray(value['operations'])) throw new Error("Ship state schema is invalid.");
  const state = value['state'];
  if (!text(state['invocationId']) || !Number.isInteger(state['revision']) || !text(state['phase']) || !object(state['candidate']) || !object(state['handoff']) || !Number.isInteger(state['repairs']) || !Array.isArray(state['stableKeys'])) throw new Error("Ship state schema is invalid.");
  validateBuildHandoff(state['handoff']);
  return value as unknown as ShipSnapshot;
}

function atomicWrite(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  try { fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); }
}

export class ShipStore {
  readonly directory: string;
  readonly handoffPath: string;
  readonly statePath: string;
  readonly invocationPath: string;
  constructor(directory: string) {
    this.directory = directory;
    this.handoffPath = path.join(directory, "handoff.json");
    this.statePath = path.join(directory, "state.json");
    this.invocationPath = path.join(directory, "invocation.json");
  }

  issueInvocation(now = Date.now()): string {
    const invocationId = crypto.randomUUID();
    atomicWrite(this.invocationPath, { version: 1, invocationId, issuedAt: now });
    return invocationId;
  }
  loadInvocation(): string {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(this.invocationPath, "utf8"));
      if (!object(value) || value["version"] !== 1 || !text(value["invocationId"]) || typeof value["issuedAt"] !== "number") throw new Error();
      return value["invocationId"];
    } catch { throw new Error("No command-issued dev-ship invocation is active."); }
  }

  loadHandoff(): BuildHandoff {
    try { return validateBuildHandoff(JSON.parse(fs.readFileSync(this.handoffPath, "utf8"))); }
    catch (error) { if (error instanceof Error && error.message.includes("schema")) throw error; throw new Error("No valid build handoff is recorded for this worktree."); }
  }
  saveHandoff(handoff: BuildHandoff): void { atomicWrite(this.handoffPath, handoff); }
  load(): ShipSnapshot | undefined {
    if (!fs.existsSync(this.statePath)) return undefined;
    try { return validateShipSnapshot(JSON.parse(fs.readFileSync(this.statePath, "utf8"))); }
    catch (error) { if (error instanceof Error && error.message.includes("schema")) throw error; throw new Error("Ship state schema is invalid."); }
  }
  save(snapshot: ShipSnapshot): void { validateShipSnapshot(snapshot); atomicWrite(this.statePath, snapshot); }
  append(record: OperationRecord): ShipSnapshot {
    const current = this.load();
    if (!current) throw new Error("Cannot journal an operation before ship state exists.");
    if (record.status === "receipt" && !current['operations'].some(item => item.id === record.id && item.status === "intent")) throw new Error("Operation receipt has no matching intent.");
    const next = { ...current, operations: [...current['operations'], record] };
    this.save(next); return next;
  }
}
