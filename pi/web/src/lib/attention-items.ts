import type { Workspace } from "./workspace"

export type AttentionItem = { id: string; kind: "revision" | "decision" | "waiting" | "finish"; title: string; subject: string; done: boolean }
export function deriveAttentionItems(workspace: Workspace | null): AttentionItem[] {
  const current = workspace?.state.current
  const pending = workspace?.state.pending
  const items: AttentionItem[] = []
  if (pending) items.push({ id: `revision:${pending.version}`, kind: "revision", title: "Inspect the proposed revision", subject: pending.version, done: false })
  if (current) {
    for (const decision of current.decisions) items.push({ id: `decision:${decision.id}`, kind: "decision", title: decision.title || decision.subject, subject: decision.id, done: decision.status !== "open" })
    for (const question of workspace!.state.discussions.filter(m => m.author === "human" && m.status === "queued" && m.version === current.version)) items.push({ id: `waiting:${question.id}`, kind: "waiting", title: `Waiting for an answer about ${current.decisions.find(d => d.id === question.subject)?.subject || current.sections.find(s => s.id === question.subject)?.title || "the review"}`, subject: question.subject, done: false })
  }
  items.push({ id: "finish", kind: "finish", title: current ? "Finish review" : "Await the first publication", subject: "general", done: !!current && workspace?.state.approval?.version === current.version && workspace.canApprove })
  return items
}
export function deriveCurrentAttentionItem(items: AttentionItem[], selectedId: string): AttentionItem {
  return items.find(item => item.id === selectedId) || items.find(item => !item.done && item.kind === "revision") || items.find(item => !item.done && item.kind === "decision") || items.find(item => !item.done && item.kind === "finish") || items.at(-1)!
}
export function deriveProgress(workspace: Workspace | null, items: AttentionItem[]) {
  const decisions = items.filter(item => item.kind === "decision")
  return { remaining: decisions.filter(item => !item.done).length, cleared: decisions.filter(item => item.done).length, total: decisions.length + Number(items.some(item => item.kind === "revision")), waiting: items.filter(item => item.kind === "waiting").length, blockers: Number(!!workspace?.state.pending) + Number(!!workspace?.state.current && !workspace.state.pending && !["Current spec", "Current candidate", "Resolve consequential decisions"].includes(workspace.gate)) }
}
