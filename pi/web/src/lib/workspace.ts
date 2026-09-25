export type Phase = "spec" | "review"
export type Section = { id: string; title: string; kind: string; body: string }
export type VisualNode = { id: string; label: string; sublabel?: string; group?: string; emphasis?: "normal" | "primary" | "warning" }
export type VisualEdge = { from: string; to: string; label?: string; emphasis?: "normal" | "warning" }
export type AttentionVisual =
  | { type: "option_comparison"; options: { id?: string; label: string; summary?: string; benefit?: string; cost?: string; benefits?: string[]; costs?: string[]; recommended?: boolean }[] }
  | { type: "sequence_flow" | "dependency_path"; nodes: VisualNode[]; edges: VisualEdge[] }
  | { type: "architecture_graph"; nodes: VisualNode[]; edges: VisualEdge[] }
  | { type: "state_machine"; states: { id: string; label: string; emphasis?: VisualNode["emphasis"] }[]; transitions: VisualEdge[] }
  | { type: "evidence_chain"; steps: ({ label: string; detail?: string; emphasis?: VisualNode["emphasis"] } | string)[] }
  | { type: "sequence_flow" | "state_machine" | "evidence_chain" | "dependency_path"; steps: string[] }
  | { type: "architecture_delta" | "semantic_diff"; before: string | { title?: string; summary: string; items?: string[] }; after: string | { title?: string; summary: string; items?: string[] } }
export type EvidenceItem = string | { label?: string; summary: string; source?: string }
export type CodeItem = string | { path?: string; lines?: string; symbol?: string; summary: string; excerpt?: string }
export type DecisionOption = { id: string; label: string; summary: string; benefits?: string[]; costs?: string[] }
export type Decision = { id: string; subject: string; title?: string; summary?: string; recommendation: string; recommendationReason?: string; recommendedOptionId?: string; options?: DecisionOption[]; consequence: string; kind?: "choice" | "risk"; status: "open" | "accepted" | "waived"; version: string; context?: { explanation?: string; mentalModel?: string; architecture?: string; remember?: string; evidence?: EvidenceItem[]; code?: CodeItem[] }; visual?: AttentionVisual }
export type Discussion = { id: string; subject: string; version: string; author: "human" | "agent"; text: string; status?: "queued" | "answered" | "failed" }
export type Document = { version: string; sections: Section[]; decisions: Decision[]; recommendation: string; markdown?: string; candidate?: { head: string; main: string; clean: boolean }; at: number }
export type Workspace = {
  phase: Phase; project: string; path: string; workspace: string; active: boolean; gate: string; canApprove: boolean
  state: { prompt?: { motivation: string; decision: Decision }; promptVersions?: string[]; current?: Document; pending?: Document; updates: Document[]; discussions: Discussion[]; drafts: Record<string, string>; selection: string; notice?: string; approval?: { version: string } }
}
export type Action = { action: "submit" | "request_changes" | "draft" | "decide" | "approve" | "apply"; version: string; subject?: string; text?: string; id?: string; status?: "accepted" | "waived" }
const token = location.pathname.split("/")[1]
export async function request(action: Action): Promise<void> {
  const response = await fetch("action", { method: "POST", headers: { "Content-Type": "application/json", "X-Workspace-Request": token }, body: JSON.stringify(action) })
  const body: { error?: string } = await response.json()
  if (!response.ok) throw new Error(body.error || "Request could not be completed")
}
export async function loadWorkspace(): Promise<Workspace> {
  const response = await fetch("state", { cache: "no-store" })
  if (!response.ok) throw new Error("Workspace unavailable. Reopen it from Pi.")
  return await response.json() as Workspace
}
