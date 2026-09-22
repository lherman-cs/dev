import { digest } from "./github-evidence.ts";
import type { ApprovalIdentity, FinalPacket } from "./ship-contracts.ts";

export const packetHash = (packet: FinalPacket): string => digest(packet);
/** The caller supplies the human identity only after a code-owned confirmation succeeds. */
export function approvePacket(packet: FinalPacket, expectedHash: string, approver: string, now = Date.now()): ApprovalIdentity {
  const actual = packetHash(packet);
  if (expectedHash !== actual) throw new Error("Final packet drifted before approval.");
  if (packet.pullRequest.draft !== true || packet.ci.status !== "passed" || packet.reviewer.verdict !== "PASS") throw new Error("Final packet is not eligible for ready-for-review approval.");
  return { packetHash: actual, approvedAt: now, approver };
}
export function renderFinalPacket(packet: FinalPacket): string {
  return [`Candidate: ${packet.candidate.branch.name}@${packet.candidate.branch.head}`, `PR: ${packet.pullRequest.url}`, `Local checks: ${packet.localChecks.map(check => `${check.name}=${check.status}`).join(", ") || "none"}`, `CI: ${packet.ci.status}`, `Review: ${packet.reviewer.verdict}`, `Repair rounds: ${packet.repairRounds}`, `Risks: ${packet.residualRisks.join("; ") || "none"}`, `Packet hash: ${packetHash(packet)}`].join("\n");
}
