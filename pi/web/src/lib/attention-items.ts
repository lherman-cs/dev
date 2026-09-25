import type { Workspace } from "./workspace"

export type AttentionItem = { id: string; kind: "revision" | "decision" | "waiting" | "finish"; title: string; subject: string; done: boolean }
export function deriveAttentionItems(workspace: Workspace | null): AttentionItem[] {
  const current = workspace?.state.current
  const pending = workspace?.state.pending
  const prompt = workspace?.phase === "spec" && !current ? workspace.state.prompt?.decision : undefined
  const items: AttentionItem[] = []
  if (current) for (const decision of current.decisions) items.push({ id: `decision:${decision.id}`, kind: "decision", title: decision.title || decision.subject, subject: decision.id, done: decision.status !== "open" })
  else if (prompt) items.push({ id: `decision:${prompt.id}`, kind: "decision", title: prompt.title || prompt.subject, subject: prompt.id, done: prompt.status !== "open" })
  if (pending) items.push({ id: `revision:${pending.version}`, kind: "revision", title: "Inspect the proposed revision", subject: pending.version, done: false })
  const questions = workspace?.state.discussions.filter(m => m.author === "human" && m.status === "queued" && (m.version === current?.version || workspace.phase === "spec" && (m.version === "unassessed" || workspace.state.promptVersions?.includes(m.version)))) || []
  for (const question of questions) items.push({ id: `waiting:${question.id}`, kind: "waiting", title: `Waiting for an answer about ${current?.decisions.find(d => d.id === question.subject)?.subject || (prompt?.id === question.subject && prompt.subject) || current?.sections.find(s => s.id === question.subject)?.title || "the proposal"}`, subject: question.subject, done: false })
  items.push({ id: "finish", kind: "finish", title: current ? workspace?.phase === "spec" ? "Review final spec" : "Finish review" : "Waiting for the agent", subject: "general", done: !!current && workspace?.state.approval?.version === current.version && workspace.canApprove })
  return items
}
export function deriveCurrentAttentionItem(items: AttentionItem[], selectedId: string): AttentionItem {
  return items.find(item => item.id === selectedId) || items.find(item => !item.done && item.kind === "decision") || items.find(item => !item.done && item.kind === "revision") || items.find(item => !item.done && item.kind === "waiting") || items.at(-1)!
}
export function deriveProgress(workspace: Workspace | null, items: AttentionItem[]) {
  const decisions = items.filter(item => item.kind === "decision")
  return { remaining: decisions.filter(item => !item.done).length, cleared: decisions.filter(item => item.done).length, total: decisions.length, waiting: items.filter(item => item.kind === "waiting").length, blockers: Number(!!workspace?.state.pending) + Number(!!workspace?.state.current && !workspace.state.pending && !["Current spec", "Current candidate", "Resolve consequential decisions"].includes(workspace.gate)) }
}
