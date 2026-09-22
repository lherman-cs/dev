import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { approvePacket, packetHash, renderFinalPacket } from "./final-packet.ts";
import type { ApprovalIdentity, FinalPacket, WaitOutcome } from "./ship-contracts.ts";

export function renderWaitProgress(outcome: Pick<WaitOutcome, "checks" | "observedSignals" | "reason">, requiredIds: readonly string[], expectedSignals: readonly string[]): string {
  const checks = new Map(outcome.checks.map(check => [check.id, check]));
  const done = requiredIds.filter(id => checks.get(id)?.state === "COMPLETED").length;
  const signals = new Set(outcome.observedSignals ?? []);
  return `Waiting: checks ${done}/${requiredIds.length}, review signals ${expectedSignals.filter(item => signals.has(item)).length}/${expectedSignals.length}${outcome.reason ? ` (${outcome.reason})` : ""}`;
}

export function renderApprovalPacket(packet: FinalPacket): string {
  const inventory = packet.inventory.items.map(item => `${item.kind}:${item.id}=${item.state}`).join(", ") || "none";
  const dispositions = packet.reviewer.dispositions.map(item => `${item.itemId}=${item.disposition}`).join(", ") || "none";
  return [renderFinalPacket(packet), `Inventory: ${inventory}`, `Dispositions: ${dispositions}`, `Summary: ${packet.summary}`].join("\n");
}

/** Approval is possible only through a dialog that displays the same hash passed to approvePacket. */
export async function confirmFinalPacket(packet: FinalPacket, ui: Pick<ExtensionUIContext, "confirm"> | undefined, approver: string, now = Date.now()): Promise<ApprovalIdentity> {
  if (!ui) throw new Error("Human approval is required; no interactive UI is available.");
  const hash = packetHash(packet), confirmed = await ui.confirm("Ready for review?", renderApprovalPacket(packet));
  if (!confirmed) throw new Error("Human cancelled final packet approval.");
  return approvePacket(packet, hash, approver, now);
}
