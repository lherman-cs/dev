export type Phase = "spec" | "review"
export type Section = { id: string; title: string; kind: string; body: string }
export type Decision = { id: string; subject: string; recommendation: string; consequence: string; kind?: "choice" | "risk"; status: "open" | "accepted" | "waived"; version: string }
export type Discussion = { id: string; subject: string; version: string; author: "human" | "agent"; text: string; status?: "queued" | "answered" | "failed" }
export type Document = { version: string; sections: Section[]; decisions: Decision[]; recommendation: string; markdown?: string; candidate?: { head: string; main: string; clean: boolean }; at: number }
export type Workspace = {
  phase: Phase; project: string; path: string; workspace: string; active: boolean; gate: string; canApprove: boolean
  state: { current?: Document; pending?: Document; updates: Document[]; discussions: Discussion[]; drafts: Record<string, string>; selection: string; notice?: string; approval?: { version: string } }
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
