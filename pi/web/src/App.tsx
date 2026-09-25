import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowRight, Check, List, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { WorkspaceShell } from "@/components/workspace/workspace-shell"
import { DecisionPacket, type Depth } from "@/components/workspace/decision-packet"
import { ContextDrawer } from "@/components/workspace/context-drawer"
import { RevisionPacket } from "@/components/workspace/revision-packet"
import { FinishPacket } from "@/components/workspace/finish-packet"
import { deriveAttentionItems, deriveCurrentAttentionItem, deriveProgress } from "@/lib/attention-items"
import { loadWorkspace, request, type Action, type Workspace } from "@/lib/workspace"

type Outcome = "comment" | "request_changes" | "approve"
const short = (id?: string) => id?.slice(0, 8) || "unassessed"
const key = (space: string, subject: string) => `dev-workspace:${space}:${subject}`
function saved(space: string, subject: string, fallback = "") { try { return localStorage.getItem(key(space, subject)) ?? fallback } catch { return fallback } }
function save(space: string, subject: string, value: string) { try { localStorage.setItem(key(space, subject), value) } catch { /* server copy may still be available */ } }
export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [focusId, setFocusId] = useState("")
  const [depth, setDepth] = useState<Depth>(null)
  const [queue, setQueue] = useState(false)
  const [palette, setPalette] = useState(false)
  const [query, setQuery] = useState("")
  const [review, setReview] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>("comment")
  const [reviewText, setReviewText] = useState("")
  const [draft, setDraft] = useState("")
  const [draftSubject, setDraftSubject] = useState("")
  const [draftVersion, setDraftVersion] = useState("")
  const [inspected, setInspected] = useState<string[]>([])
  const [inspectedVersion, setInspectedVersion] = useState("")
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({})
  const [waiver, setWaiver] = useState(false)
  const [dark, setDark] = useState(() => { try { return localStorage.getItem("workspace-theme") === "dark" } catch { return false } })
  const sequence = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const initialized = useRef("")
  const previousTarget = useRef("")
  const refresh = useCallback(async () => {
    const n = ++sequence.current
    try {
      const data = await loadWorkspace()
      if (sequence.current !== n) return
      const target = `${data.state.current?.version || ""}:${data.state.pending?.version || ""}:${data.state.current?.candidate?.head || ""}:${data.gate}`
      if (previousTarget.current && previousTarget.current !== target) { setReview(false); setWaiver(false); setNotice("The review target changed. Inspect the current state before acting.") }
      previousTarget.current = target
      setWorkspace(data); setError("")
    } catch (e) { if (sequence.current === n) setError(e instanceof Error ? e.message : "Workspace disconnected") }
  }, [])
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 2500); return () => { clearInterval(timer); sequence.current++ } }, [refresh])
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); try { localStorage.setItem("workspace-theme", dark ? "dark" : "light") } catch { /* theme is optional */ } }, [dark])
  const current = workspace?.state.current
  const pending = workspace?.state.pending
  const version = current?.version || "unassessed"
  const phase = workspace?.phase || "spec"
  const entries = deriveAttentionItems(workspace)
  const item = deriveCurrentAttentionItem(entries, focusId)
  const decision = current?.decisions.find(d => item.kind === "decision" && d.id === item.subject)
  const comments = workspace?.state.discussions.filter(m => m.subject === item.subject) || []
  const progress = deriveProgress(workspace, entries)
  const approved = !!current && workspace?.state.approval?.version === version && workspace.canApprove
  const canApprove = !!workspace?.active && !!workspace.canApprove && !pending && !error && !approved
  const canDecide = !!workspace?.active && !pending && !error && ["Current candidate", "Current spec", "Resolve consequential decisions"].includes(workspace.gate)
  const canRequest = !!workspace?.active && !!current && !pending && !error && canDecide
  const selectedOption = decision ? selectedOptions[decision.id] || decision.recommendedOptionId || "" : ""
  const selectedAlternative = !!decision?.options?.some(option => option.id === selectedOption && option.id !== decision.recommendedOptionId)
  useEffect(() => { if (!workspace || initialized.current === workspace.workspace) return; initialized.current = workspace.workspace; setReviewText(saved(workspace.workspace, "review")) }, [workspace?.workspace])
  useEffect(() => { if (!workspace || draftSubject === item.subject) return; setDraftSubject(item.subject); setDraft(saved(workspace.workspace, item.subject, workspace.state.drafts[item.subject] || "")); setDraftVersion(saved(workspace.workspace, `version:${item.subject}`, version)) }, [workspace?.workspace, item.subject, draftSubject, version])
  useEffect(() => { if (!workspace || !draft || draftSubject !== item.subject || draftVersion !== version) return; const timer = window.setTimeout(() => { void request({ action: "draft", subject: item.subject, text: draft, version }).catch(() => {}) }, 600); return () => clearTimeout(timer) }, [workspace?.workspace, draft, draftSubject, draftVersion, item.subject, version])
  const updateDraft = (value: string) => { if (!workspace) return; const anchor = draft && draftVersion !== version ? draftVersion : version; setDraft(value); setDraftVersion(anchor); save(workspace.workspace, item.subject, value); save(workspace.workspace, `version:${item.subject}`, anchor) }
  function choose(id: string) { setFocusId(id); setDepth(null); setQueue(false); setPalette(false); window.setTimeout(() => heading.current?.focus(), 0) }
  function next() { const index = entries.findIndex(i => i.id === item.id); choose(entries[Math.min(index + 1, entries.length - 1)].id) }
  function previous() { const index = entries.findIndex(i => i.id === item.id); choose(entries[Math.max(0, index - 1)].id) }
  function openDepth(value: Depth) { setDepth(value); if (value === "discussion") window.setTimeout(() => editor.current?.focus(), 0) }
  async function act(action: Action, success: string) {
    setBusy(true)
    try { await request(action); setNotice(success); setError(""); setFocusId(""); setDepth(null); setInspected([]); await refresh(); window.setTimeout(() => heading.current?.focus(), 0) }
    catch (e) { setNotice(`Not completed: ${e instanceof Error ? e.message : String(e)}. State was refreshed; inspect before retrying.`); await refresh() }
    finally { setBusy(false) }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (!draft.trim() || !workspace || busy || draftVersion !== version) return
    const text = draft, subject = item.subject
    setBusy(true)
    try { await request({ action: "submit", subject, text, version }); setNotice("Question sent on this item. Your decision remains open."); setDraft(""); save(workspace.workspace, subject, ""); await refresh() }
    catch (e) { setNotice(`Delivery uncertain or failed: ${String(e)}. Draft retained; inspect state before retrying.`); await refresh() }
    finally { setBusy(false) }
  }
  async function submitReview(event: React.FormEvent) {
    event.preventDefault(); if (busy || (outcome === "approve" ? !canApprove : !reviewText.trim()) || (outcome === "request_changes" && !canRequest)) return
    const action: Action = { action: outcome === "comment" ? "submit" : outcome, subject: "general", text: reviewText, version }
    setBusy(true)
    try { await request(action); setReview(false); setNotice(outcome === "approve" ? "Approved this exact revision. No next phase started." : outcome === "request_changes" ? "Changes requested. Await a new revision." : "Comment sent without approval."); setReviewText(""); if (workspace) save(workspace.workspace, "review", ""); await refresh() }
    catch (e) { setNotice(`Review delivery uncertain or failed: ${String(e)}. Text retained; inspect state before retrying.`); await refresh() }
    finally { setBusy(false) }
  }
  const accept = () => { if (decision && !selectedAlternative && canDecide && !busy) void act({ action: "decide", id: decision.id, status: "accepted", version }, "Decision recorded. Moving to the next item.") }
  const alternative = () => { const option = decision?.options?.find(choice => choice.id === selectedOption); if (decision && option && canRequest && !busy) void act({ action: "request_changes", subject: decision.id, text: `Choose alternative for ${decision.subject}: ${option.label}. ${option.summary}`, version }, "Alternative requested. Await a revised assessment before approval.") }
  useEffect(() => { const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(v => !v); return }
    if (e.key === "Escape" && depth && !queue && !palette && !review && !waiver) { e.preventDefault(); setDepth(null); heading.current?.focus(); return }
    if (e.altKey || e.metaKey || e.ctrlKey || e.target instanceof HTMLElement && (e.target.closest("input,textarea,[contenteditable=true],[role=dialog]") || e.target.tagName === "SUMMARY" || e.target.closest("button")) || queue || palette || review || waiver) return
    const k = e.key.toLowerCase()
    if (k === "j" || k === "arrowdown") { e.preventDefault(); next() }
    if (k === "k" || k === "arrowup") { e.preventDefault(); previous() }
    if (k === "?" || k === "w") openDepth("why")
    if (k === "e" && decision?.context?.evidence?.length) openDepth("evidence")
    if (k === "c" && decision?.context?.code?.length) openDepth("code")
    if (k === "a") openDepth("discussion")
    if (k === "d") { if (decision?.options?.length) { const other = decision.options.find(option => option.id !== decision.recommendedOptionId); if (other) setSelectedOptions(options => ({ ...options, [decision.id]: other.id })) } else openDepth("discussion") }
    if (k === "enter" && decision?.status === "open" && canDecide && !selectedAlternative && !busy && (e.target === document.body || e.target === heading.current)) { e.preventDefault(); accept() }
  }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey) })
  return <WorkspaceShell items={entries} selected={item.id} onSelect={choose} project={workspace?.project || "Workspace"} phase={phase} summary={progress} dark={dark} toggleTheme={() => setDark(!dark)} commands={() => setPalette(true)} finish={() => choose("finish")}>
    {(notice || error || workspace?.state.notice) && <p role="status" aria-live="polite" className="mb-7 border-l-2 border-primary px-3 text-sm">{error || notice || workspace?.state.notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>{item.kind === "decision" ? `Review ${entries.indexOf(item) + 1} of ${entries.length}` : phase === "spec" ? "SPECIFICATION" : "IMPLEMENTATION REVIEW"} {decision?.kind === "risk" && " · Disclosed risk"}</span><button className="quiet-link" onClick={() => setQueue(true)}><List size={15}/> Review queue</button></div>
    <p className="eyebrow mt-9">{item.kind === "revision" ? "PROPOSED REVISION" : item.kind === "decision" ? "NEXT DECISION" : item.kind === "waiting" ? "WAITING FOR AGENT" : "FINISH LINE"}</p>
    <h1 ref={heading} tabIndex={-1} className="mt-2 max-w-3xl text-[30px] font-semibold leading-[1.16] tracking-tight outline-none">{item.title}</h1>
    <p className="mt-3 text-xs text-muted-foreground">{item.kind === "revision" ? `Proposed ${short(pending?.version)} · Current ${short(version)}` : item.kind === "finish" ? `Exact ${phase === "spec" ? "spec" : "candidate"} · ${short(current?.candidate?.head || version)}` : `Revision ${short(version)}`}</p>
    {decision && <DecisionPacket decision={decision} phase={phase} disabled={!canDecide} busy={busy} selectedOption={selectedOption} setSelectedOption={id => setSelectedOptions(options => ({ ...options, [decision.id]: id }))} accept={accept} alternative={alternative} waive={() => setWaiver(true)} depth={openDepth}/>}
    {item.kind === "revision" && pending && <RevisionPacket current={current} pending={pending} inspected={inspectedVersion === pending.version ? inspected : []} onInspect={id => { setInspectedVersion(pending.version); setInspected(previous => inspectedVersion === pending.version ? [...new Set([...previous, id])] : [id]) }} apply={() => void act({ action: "apply", version }, "Revision applied. Review the new target separately.")} disabled={busy || !!error}/>}
    {item.kind === "waiting" && <div className="mt-8 space-y-5"><p className="text-base leading-7">Your question is with the agent. Its answer remains attached to this decision and will not decide it for you.</p><Button variant="outline" onClick={() => choose(entries.find(entry => entry.kind === "decision" && !entry.done)?.id || "finish")}>Continue to another item <ArrowRight size={15}/></Button></div>}
    {item.kind === "finish" && <><FinishPacket current={current?.candidate?.head || current?.version} phase={phase} remaining={progress.remaining} blockers={progress.blockers} waiting={progress.waiting} gate={workspace?.gate} approved={approved} canApprove={canApprove} active={!!workspace?.active && !busy && !error} onReview={() => { setOutcome(canApprove ? "approve" : "comment"); setReview(true) }} onNext={() => choose(entries.find(entry => entry.kind === "decision" && !entry.done)?.id || entries[0].id)}/>{!current && <form onSubmit={send} className="mt-6 space-y-3"><label htmlFor="early-question" className="text-sm font-medium">Ask the agent about the desired outcome</label><Textarea id="early-question" value={draft} onChange={e => updateDraft(e.target.value)} rows={3} maxLength={20000}/><Button type="submit" disabled={!workspace?.active || !!error || busy || !draft.trim()}>Send question</Button></form>}</>}
    {current && item.kind !== "decision" && <div className="mt-9 flex flex-wrap gap-4 border-t pt-5 text-sm"><button className="quiet-link" onClick={() => openDepth("artifact")}>Full artifact</button><button className="quiet-link" onClick={() => openDepth("discussion")}>Ask agent</button></div>}
    <div className="mt-12 flex justify-between border-t pt-4 text-xs"><button className="quiet-link" onClick={previous} disabled={item.id === entries[0]?.id}>← Previous</button><span className="text-muted-foreground">{entries.indexOf(item) + 1} / {entries.length}</span><button className="quiet-link" onClick={next} disabled={item.id === entries.at(-1)?.id}>Next →</button></div>
    {depth && <ContextDrawer view={depth} close={() => { setDepth(null); heading.current?.focus() }} decision={decision} current={current} messages={comments} version={version} draft={draft} draftVersion={draftVersion} changeDraft={updateDraft} reanchor={() => { setDraftVersion(version); if (workspace) save(workspace.workspace, `version:${item.subject}`, version) }} send={send} busy={busy} active={!!workspace?.active && !error} editor={editor}/>}
    <Dialog open={queue} onOpenChange={setQueue}><DialogContent><DialogHeader><DialogTitle>Review queue</DialogTitle><DialogDescription>{progress.remaining} decisions · {progress.blockers} blockers · {progress.waiting} waiting. Jumping never resolves an item.</DialogDescription></DialogHeader><div className="max-h-[60vh] divide-y overflow-auto">{entries.map(entry => <button key={entry.id} className="queue-item" onClick={() => choose(entry.id)}><span>{entry.done ? <Check size={16}/> : <ArrowRight size={16}/>}</span><span className="flex-1"><strong>{entry.title}</strong><small>{entry.done ? "Done" : entry.kind === "waiting" ? "Waiting" : entry.kind === "revision" ? "Inspect before applying" : "Ready"}</small></span></button>)}</div></DialogContent></Dialog>
    <Dialog open={palette} onOpenChange={setPalette}><DialogContent><DialogHeader><DialogTitle>Jump to an item</DialogTitle><DialogDescription>Ctrl/⌘ K · J/K navigate · Enter accept · A ask · D alternative · W why · E evidence · C code</DialogDescription></DialogHeader><div className="flex items-center gap-2 border-b"><Search size={16}/><input autoFocus className="w-full bg-transparent py-2 text-sm outline-none" aria-label="Find an item" placeholder="Find a decision" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="max-h-[50vh] divide-y overflow-auto">{entries.filter(entry => entry.title.toLowerCase().includes(query.toLowerCase())).map(entry => <button key={entry.id} className="queue-item" onClick={() => { choose(entry.id); setQuery("") }}><span className="flex-1">{entry.title}</span><ArrowRight size={16}/></button>)}</div></DialogContent></Dialog>
    <Dialog open={review} onOpenChange={setReview}><DialogContent><DialogHeader><DialogTitle>Submit review</DialogTitle><DialogDescription>Exact {phase === "spec" ? "spec revision" : "candidate"} {short(current?.candidate?.head || version)}. Approval does not start another phase. {progress.waiting} waiting; {progress.remaining} decisions open. {current?.decisions.filter(d => d.status === "waived").length ? `${current.decisions.filter(d => d.status === "waived").length} disclosed risk waived.` : ""}</DialogDescription></DialogHeader><form onSubmit={submitReview} className="space-y-4"><fieldset className="space-y-2"><legend className="sr-only">Review outcome</legend>{([["comment", "Comment without approval"], ["request_changes", "Request changes"], ["approve", "Approve exact target"]] as const).map(([id, label]) => <label key={id} className="flex items-center gap-3 text-sm"><input type="radio" name="outcome" value={id} checked={outcome === id} disabled={(id === "approve" && !canApprove) || (id === "request_changes" && !canRequest)} onChange={() => setOutcome(id)}/>{label}</label>)}</fieldset>{!canApprove && <p className="text-xs text-muted-foreground">Approval unavailable: {workspace?.gate || "No current target"}.</p>}{outcome !== "approve" && <div><label htmlFor="review-text" className="text-sm">{outcome === "request_changes" ? "Required change" : "Comment"}</label><Textarea id="review-text" className="mt-2" value={reviewText} onChange={e => { setReviewText(e.target.value); if (workspace) save(workspace.workspace, "review", e.target.value) }} maxLength={20000} rows={3}/></div>}<DialogFooter><Button type="button" variant="outline" onClick={() => setReview(false)}>Return</Button><Button type="submit" disabled={busy || (outcome === "approve" ? !canApprove : !reviewText.trim() || (outcome === "request_changes" && !canRequest))}>{outcome === "approve" ? "Approve revision" : outcome === "request_changes" ? "Request changes" : "Send comment"}</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={waiver} onOpenChange={setWaiver}><DialogContent><DialogHeader><DialogTitle>Waive this disclosed risk?</DialogTitle><DialogDescription>{decision?.subject}. {decision?.consequence} The waiver stays visible on this exact revision; approval remains separate.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setWaiver(false)}>Keep reviewing</Button><Button disabled={busy} onClick={() => { if (decision) void act({ action: "decide", id: decision.id, status: "waived", version }, "Risk waiver recorded. Moving to the next item."); setWaiver(false) }}>Confirm waiver</Button></DialogFooter></DialogContent></Dialog>
  </WorkspaceShell>
}
