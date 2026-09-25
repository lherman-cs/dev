import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, Check, Command, List, MessageCircle, Moon, Search, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Prose } from "@/components/prose"
import { AttentionVisual } from "@/components/attention-visual"
import { loadWorkspace, request, type Action, type Discussion, type Document, type Workspace } from "@/lib/workspace"

type Item = { id: string; kind: "revision" | "decision" | "question" | "finish"; title: string; subject: string; done: boolean }
type Depth = "why" | "architecture" | "evidence" | "code" | "discussion" | "artifact" | null
type Outcome = "comment" | "request_changes" | "approve"
const short = (id?: string) => id?.slice(0, 8) || "unassessed"
const key = (space: string, subject: string) => `dev-workspace:${space}:${subject}`
function saved(space: string, subject: string, fallback = "") { try { return localStorage.getItem(key(space, subject)) ?? fallback } catch { return fallback } }
function save(space: string, subject: string, value: string) { try { localStorage.setItem(key(space, subject), value) } catch { /* server copy may still be available */ } }
function itemsFor(workspace: Workspace | null): Item[] {
  const doc = workspace?.state.current
  const pending = workspace?.state.pending
  const items: Item[] = []
  if (pending) items.push({ id: `revision:${pending.version}`, kind: "revision", title: "Inspect the proposed revision", subject: pending.version, done: false })
  if (doc) {
    for (const d of [...doc.decisions].sort((a, b) => Number(b.kind === "risk") - Number(a.kind === "risk"))) items.push({ id: `decision:${d.id}`, kind: "decision", title: d.subject, subject: d.id, done: d.status !== "open" })
    const waiting = workspace!.state.discussions.filter(m => m.author === "human" && m.status === "queued" && m.version === doc.version)
    for (const m of waiting) items.push({ id: `question:${m.id}`, kind: "question", title: `Waiting for an answer about ${doc.sections.find(s => s.id === m.subject)?.title || doc.decisions.find(d => d.id === m.subject)?.subject || "the review"}`, subject: m.subject, done: false })
  }
  items.push({ id: "finish", kind: "finish", title: doc ? "Submit your review" : "Await the first published assessment", subject: "general", done: !doc || Boolean(workspace?.state.approval?.version === doc.version && workspace.canApprove) })
  return items
}
function Thread({ messages, version }: { messages: Discussion[]; version: string }) {
  return <div className="divide-y border-y" aria-label="Discussion on this item">{messages.length ? messages.map(m => <div key={m.id} className="py-3 text-sm"><p className="text-xs text-muted-foreground"><strong className="text-foreground">{m.author === "human" ? "You" : "Agent"}</strong> · {m.version === version ? "Current revision" : `Earlier revision ${short(m.version)}`} {m.status ? `· ${m.status === "queued" ? "Awaiting response" : m.status === "failed" ? "Not delivered" : "Answered"}` : ""}</p><div className="mt-1"><Prose text={m.text} /></div></div>) : <p className="py-3 text-sm text-muted-foreground">No discussion yet. Ask about this exact item.</p>}</div>
}
function Changes({ current, pending }: { current?: Document; pending: Document }) {
  const changed = pending.sections.filter(s => !current?.sections.some(old => old.id === s.id && old.title === s.title && old.body === s.body))
  const removed = current?.sections.filter(s => !pending.sections.some(next => next.id === s.id)) || []
  return <div className="space-y-5 text-sm">
    {current?.recommendation !== pending.recommendation && <div><h3 className="font-medium">Recommendation changed</h3><p className="mt-2 text-muted-foreground">Before: {current?.recommendation || "None"}</p><div className="mt-2"><Prose text={pending.recommendation} /></div></div>}
    {changed.map(s => <section key={s.id} className="border-t pt-4"><h3 className="font-medium">{s.title}</h3>{current?.sections.find(old => old.id === s.id) && <div className="mt-2 border-l-2 pl-3 text-muted-foreground"><p className="text-xs">Before</p><Prose text={current.sections.find(old => old.id === s.id)!.body} /></div>}<div className="mt-2 border-l-2 border-foreground pl-3"><p className="text-xs text-muted-foreground">Proposed</p><Prose text={s.body} /></div></section>)}
    {removed.map(s => <p key={s.id} className="border-t pt-3">Removed: {s.title}</p>)}
    {JSON.stringify(current?.decisions) !== JSON.stringify(pending.decisions) && <p className="border-t pt-3">Decisions to reconsider: {pending.decisions.map(d => d.subject).join(", ") || "none"}</p>}
    {!changed.length && !removed.length && current?.recommendation === pending.recommendation && <p>Artifact, candidate, or decision state changed. Inspect the full proposed artifact below before applying.</p>}
    <details className="border-t pt-3"><summary className="cursor-pointer font-medium">Full proposed artifact</summary><div className="mt-3"><Prose text={pending.markdown || pending.sections.map(s => `## ${s.title}\n${s.body}`).join("\n\n")} /></div></details>
  </div>
}
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
  const [inspected, setInspected] = useState("")
  const [confirm, setConfirm] = useState<Action | null>(null)
  const [dark, setDark] = useState(() => { try { return localStorage.getItem("workspace-theme") === "dark" } catch { return false } })
  const sequence = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const initialized = useRef("")
  const refresh = useCallback(async () => {
    const n = ++sequence.current
    try { const data = await loadWorkspace(); if (sequence.current === n) { setWorkspace(data); setError("") } }
    catch (e) { if (sequence.current === n) setError(e instanceof Error ? e.message : "Workspace disconnected") }
  }, [])
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 2500); return () => { clearInterval(timer); sequence.current++ } }, [refresh])
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); try { localStorage.setItem("workspace-theme", dark ? "dark" : "light") } catch { /* theme is optional */ } }, [dark])
  const current = workspace?.state.current
  const pending = workspace?.state.pending
  const version = current?.version || "unassessed"
  const phase = workspace?.phase || "spec"
  const entries = itemsFor(workspace)
  const defaultItem = entries.find(i => !i.done && i.kind === "revision") ||
    (workspace?.gate === "Accepted decision awaits inclusion in the durable spec and publication" ? entries.find(i => !i.done && i.kind === "question") : undefined) ||
    entries.find(i => !i.done) || entries.at(-1)!
  const item = entries.find(i => i.id === focusId) || defaultItem
  const decision = current?.decisions.find(d => item.kind === "decision" && d.id === item.subject)
  const comments = workspace?.state.discussions.filter(m => m.subject === item.subject) || []
  const open = current?.decisions.filter(d => d.status === "open").length || 0
  const waiting = workspace?.state.discussions.filter(m => m.author === "human" && m.status === "queued" && m.version === version).length || 0
  const blockers = Number(Boolean(pending)) + Number(Boolean(current && !pending && workspace?.gate !== "Current spec" && workspace?.gate !== "Current candidate" && workspace?.gate !== "Resolve consequential decisions"))
  const canApprove = Boolean(workspace?.active && workspace.canApprove && !pending && !error && workspace.state.approval?.version !== version)
  const canDecide = Boolean(workspace?.active && !pending && !error && (workspace.gate === "Current candidate" || workspace.gate === "Current spec" || workspace.gate === "Resolve consequential decisions"))
  const canRequest = Boolean(workspace?.active && current && !pending && !error && (workspace.gate === "Current candidate" || workspace.gate === "Current spec" || workspace.gate === "Resolve consequential decisions"))
  const subjectName = current?.sections.find(s => s.id === item.subject)?.title || decision?.subject || "this review"
  const total = entries.filter(i => i.kind === "decision" || i.kind === "revision").length
  const cleared = entries.filter(i => i.done && i.kind === "decision").length
  const itemEvidence = decision?.context?.evidence
  const itemCode = decision?.context?.code
  useEffect(() => { if (!workspace || initialized.current === workspace.workspace) return; initialized.current = workspace.workspace; setReviewText(saved(workspace.workspace, "review")) }, [workspace?.workspace])
  useEffect(() => { if (!workspace || draftSubject === item.subject) return; setDraftSubject(item.subject); setDraft(saved(workspace.workspace, item.subject, workspace.state.drafts[item.subject] || "")); setDraftVersion(saved(workspace.workspace, `version:${item.subject}`, version)) }, [workspace?.workspace, item.subject, draftSubject, version])
  useEffect(() => { if (!workspace || !draft || draftSubject !== item.subject || draftVersion !== version) return; const timer = window.setTimeout(() => { void request({ action: "draft", subject: item.subject, text: draft, version }).catch(() => {}) }, 600); return () => clearTimeout(timer) }, [workspace?.workspace, draft, draftSubject, draftVersion, item.subject, version])
  const updateDraft = (value: string) => { if (!workspace) return; setDraft(value); setDraftVersion(version); save(workspace.workspace, item.subject, value); save(workspace.workspace, `version:${item.subject}`, version) }
  function choose(id: string) { setFocusId(id); setDepth(null); setQueue(false); setPalette(false); window.setTimeout(() => heading.current?.focus(), 0) }
  function next() { const index = entries.findIndex(i => i.id === item.id); choose(entries[Math.min(index + 1, entries.length - 1)].id) }
  function previous() { const index = entries.findIndex(i => i.id === item.id); choose(entries[Math.max(0, index - 1)].id) }
  async function act(action: Action, success: string) {
    setBusy(true)
    try { await request(action); setNotice(success); setError(""); setFocusId(""); setDepth(null); setInspected(""); await refresh(); window.setTimeout(() => heading.current?.focus(), 0) }
    catch (e) { setNotice(`Not completed: ${e instanceof Error ? e.message : String(e)}. No automatic retry.`); await refresh() }
    finally { setBusy(false) }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (!draft.trim() || !workspace || busy || draftVersion !== version) return
    const text = draft, subject = item.subject
    setBusy(true)
    try { await request({ action: "submit", subject, text, version }); setNotice("Question sent on this item. Your decision remains open."); setDraft(""); save(workspace.workspace, subject, ""); await refresh() }
    catch (e) { setNotice(`Delivery uncertain or failed: ${String(e)}. Draft retained; do not retry without checking the thread.`); await refresh() }
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
  useEffect(() => { const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(v => !v); return }
    if (e.key === "Escape" && depth && !queue && !palette && !review && !confirm) { e.preventDefault(); setDepth(null); heading.current?.focus(); return }
    if (e.altKey || e.metaKey || e.ctrlKey || e.target instanceof HTMLElement && (e.target.closest("input,textarea,[contenteditable=true],[role=dialog]") || e.target.tagName === "SUMMARY") || queue || palette || review || confirm) return
    const k = e.key.toLowerCase()
    if (k === "j" || k === "arrowdown") { e.preventDefault(); next() }
    if (k === "k" || k === "arrowup") { e.preventDefault(); previous() }
    if (k === "?" || k === "w") setDepth("why")
    if (k === "e") setDepth("evidence")
    if (k === "c") setDepth("code")
    if (k === "a") { setDepth("discussion"); window.setTimeout(() => editor.current?.focus(), 0) }
    if (k === "d" && decision?.status === "open") { setDepth("discussion"); window.setTimeout(() => editor.current?.focus(), 0) }
    if (k === "enter" && decision?.status === "open" && canDecide && (e.target === document.body || e.target === heading.current)) { e.preventDefault(); setConfirm({ action: "decide", id: decision.id, status: "accepted", version }) }
  }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey) })
  const sections = current?.sections || []
  const evidence = sections.filter(s => /evidence|validation|outcome|risk/i.test(s.kind + " " + s.title))
  const code = sections.filter(s => /code|implementation|architecture|system/i.test(s.kind + " " + s.title))
  const status = workspace?.state.approval?.version === version && workspace.canApprove ? "Approved" : pending ? "Revision waiting" : workspace?.gate || "Assessment in preparation"
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b"><div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3 text-xs sm:px-8"><div className="min-w-0 font-medium">{workspace?.project || "Workspace"} <span className="mx-1 text-muted-foreground">/</span> {phase === "spec" ? "Spec" : "Review"} <span className="ml-2 font-normal text-muted-foreground">{cleared} / {total} cleared</span></div><div className="flex shrink-0 items-center gap-1">{canApprove && <button type="button" className="quiet-link mr-2" onClick={() => { setOutcome("approve"); setReview(true) }}>Finish {phase} <ArrowRight size={14}/></button>}<button type="button" className="icon-button" aria-label="Open commands" title="Commands · Ctrl/⌘ K" onClick={() => setPalette(true)}><Command size={16}/></button><button type="button" className="icon-button" aria-label={dark ? "Use light theme" : "Use dark theme"} onClick={() => setDark(!dark)}>{dark ? <Sun size={16}/> : <Moon size={16}/>}</button></div></div></header>
    <main className="mx-auto max-w-3xl px-5 pb-28 pt-8 sm:px-8 sm:pt-12">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{phase === "spec" ? "SPECIFICATION" : "IMPLEMENTATION REVIEW"} · {status}</span><button className="quiet-link" onClick={() => setQueue(true)}><List size={15}/> See review queue</button></div>
      <div className="mt-4 border-b pb-4" aria-label="Review progress"><div className="h-1 bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={cleared} aria-label="Items cleared"><div className="h-full bg-foreground" style={{ width: `${total ? cleared / total * 100 : 100}%` }}/></div><p className="mt-3 text-sm font-medium" aria-label="Remaining work">{open} decision{open === 1 ? "" : "s"} left <span className="mx-2 text-muted-foreground">·</span> {blockers} blocker{blockers === 1 ? "" : "s"} unresolved <span className="mx-2 text-muted-foreground">·</span> {waiting} question{waiting === 1 ? "" : "s"} waiting</p>{blockers > 0 && <p className="mt-1 text-xs text-muted-foreground">{pending ? "Inspect and apply the proposed revision." : workspace?.gate}</p>}</div>
      {(notice || error || workspace?.state.notice) && <div role="status" className="mt-5 border-l-2 border-foreground px-3 text-sm">{error || notice || workspace?.state.notice}</div>}
      <div className="mt-9"><p className="eyebrow">{item.kind === "revision" ? "REVISION TO INSPECT" : item.kind === "decision" ? decision?.kind === "risk" ? "DISCLOSED RISK" : "YOUR DECISION" : item.kind === "question" ? "WAITING FOR THE AGENT" : "FINISH LINE"}</p>
        <h1 ref={heading} tabIndex={-1} className="mt-2 text-3xl font-semibold leading-tight tracking-tight outline-none sm:text-4xl">{item.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{item.kind === "revision" ? `Proposed ${short(pending?.version)} · Current ${short(version)}` : item.kind === "finish" ? `${phase === "spec" ? "Spec" : "Candidate"} · exact revision ${short(version)}` : decision ? (decision.kind === "risk" ? "Disclosed risk · " : "Decision · ") + short(version) : subjectName}</p>
      </div>
      {item.kind === "decision" && decision && <div className="mt-9 space-y-7">
        <div><p className="eyebrow">WHY IT MATTERS</p><p className="mt-2 text-base leading-7">{decision.consequence}</p></div>
        {decision.visual && <AttentionVisual visual={decision.visual}/>}
        {decision.context?.mentalModel && <p className="border-l-2 pl-4 text-sm leading-6"><span className="font-medium">Mental model: </span>{decision.context.mentalModel}</p>}
        <div className="border-l-2 border-foreground pl-4"><p className="eyebrow">AGENT RECOMMENDS</p><div className="mt-2 text-base leading-7"><Prose text={decision.recommendation} /></div><p className="mt-2 text-xs text-muted-foreground">A recommendation is not your decision. Ask for another direction below.</p></div>
        {decision.status === "open" ? <div className="flex flex-wrap items-center gap-3 border-t pt-5"><Button disabled={!canDecide || busy} onClick={() => setConfirm({ action: "decide", id: decision.id, status: "accepted", version })}>Accept recommendation <ArrowRight size={15}/></Button>{phase === "review" && decision.kind === "risk" && <Button variant="outline" disabled={!canDecide || busy} onClick={() => setConfirm({ action: "decide", id: decision.id, status: "waived", version })}>Waive disclosed risk</Button>}<button className="quiet-link" onClick={() => { setDepth("discussion"); window.setTimeout(() => editor.current?.focus(), 0) }}>Challenge or choose differently</button></div> : <p className="border-t pt-5 text-sm"><Check size={16} className="mr-2 inline"/>{decision.status === "waived" ? "Risk waived" : "Recommendation accepted"} on this revision. <button className="quiet-link" onClick={next}>Next item <ArrowRight size={14}/></button></p>}
      </div>}
      {item.kind === "revision" && pending && <div className="mt-9 space-y-5"><p className="text-base leading-7">The agent published a new {phase === "spec" ? "specification" : "assessment"}. Inspect what changed, then apply explicitly. Application is not approval.</p><div className="flow" role="img" aria-label="Current revision, inspect proposed revision, apply, then review separately"><span>Current {short(version)}</span><ArrowRight size={16}/><span>Inspect {short(pending.version)}</span><ArrowRight size={16}/><span>Apply</span><ArrowRight size={16}/><span>Review</span></div><details className="border-y py-4" onToggle={e => { if (e.currentTarget.open) setInspected(pending.version) }}><summary className="cursor-pointer font-medium">Inspect changed subjects</summary><div className="mt-5"><Changes current={current} pending={pending}/></div></details><Button disabled={busy || inspected !== pending.version || !!error} onClick={() => void act({ action: "apply", version }, "Revision applied. Review the new target separately.")}>Apply inspected revision <ArrowRight size={15}/></Button>{inspected !== pending.version && <p className="text-xs text-muted-foreground">Open the changed subjects before applying.</p>}</div>}
      {item.kind === "question" && <div className="mt-8"><p className="text-base leading-7">Your question is with the agent. An answer will remain attached to this subject and will not decide it for you.</p><div className="mt-5"><Thread messages={comments} version={version} /></div><Button className="mt-5" variant="outline" onClick={next}>Continue to another item <ArrowRight size={15}/></Button></div>}
      {item.kind === "finish" && <div className="mt-8 space-y-5"><p className="text-base leading-7">{!current ? "The agent has not published an assessment yet. Clarify the desired outcome below, without leaving this workspace." : open ? `Resolve ${open} consequential decision${open === 1 ? "" : "s"} before approval. You can still comment or request changes.` : waiting ? `Wait for ${waiting} agent answer${waiting === 1 ? "" : "s"} before approval.` : workspace?.gate !== "Current spec" && workspace?.gate !== "Current candidate" ? `Approval is unavailable: ${workspace?.gate}.` : "All items cleared. Inspect the exact target and choose your overall review outcome."}</p>{current ? <Button onClick={() => { setOutcome(canApprove ? "approve" : "comment"); setReview(true) }} disabled={!workspace?.active || !!error || busy}>{canApprove ? `Approve ${phase}` : "Comment or request changes"} <ArrowRight size={15}/></Button> : <form onSubmit={send} className="space-y-3"><label htmlFor="early-question" className="text-sm font-medium">Ask the agent about this outcome</label><Textarea id="early-question" value={draft} onChange={e => updateDraft(e.target.value)} maxLength={20000} rows={3} placeholder="What should this work achieve?"/><p className="text-xs text-muted-foreground">Your draft is saved locally until sent.</p><Button type="submit" disabled={!workspace?.active || !!error || busy || !draft.trim()}>Send question</Button></form>}</div>}
      {current && <div className="mt-10 border-t pt-4"><p className="eyebrow">NEED MORE TO DECIDE?</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-3 text-sm">{([ ["why", "Why?"], ["architecture", "How it works"], ["evidence", "Evidence"], ["code", "Code"], ["discussion", "Discussion"], ["artifact", "Full artifact"] ] as const).map(([id, label]) => <button key={id} className="quiet-link" onClick={() => setDepth(depth === id ? null : id)} aria-expanded={depth === id}>{label}</button>)}</div>
        {depth && <section className="depth mt-6" aria-label={`${depth} for ${item.title}`}><div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{({ why: "Why this matters", architecture: "How this fits", evidence: "Published evidence", code: "Curated code and change context", discussion: `Discuss ${subjectName}`, artifact: "Full published artifact" })[depth]}</h2><Button variant="ghost" size="sm" onClick={() => { setDepth(null); heading.current?.focus() }}><ArrowLeft size={14}/> Back</Button></div>
          {depth === "why" && <div className="mt-4 space-y-4"><p className="text-sm leading-6">{decision?.context?.explanation || decision?.consequence || (item.kind === "revision" ? "Published versions must be inspected and applied separately from final approval." : current.recommendation)}</p><p className="text-sm text-muted-foreground">{decision ? `Agent's position: ${decision.recommendation}` : "The published assessment, not a live repository query, is the source for this review."}</p></div>}
          {depth === "architecture" && <div className="mt-4"><p className="text-sm leading-6">{decision?.context?.architecture || (phase === "spec" ? "The agent owns the durable spec. Your decision is recorded here, then reflected in a newly published revision before approval." : "The assessment is bound to a candidate fingerprint. When the candidate or baseline changes, approval requires a fresh assessment.")}</p><div className="flow mt-5" role="img" aria-label="Agent publishes version, human inspects and decides, approval checks the exact current target"><span>Agent publishes</span><ArrowRight size={16}/><span>You inspect and decide</span><ArrowRight size={16}/><span>Exact-target gate</span></div>{code.map(s => <details className="mt-4 border-t pt-3" key={s.id}><summary className="cursor-pointer text-sm">{s.title}</summary><div className="mt-3"><Prose text={s.body}/></div></details>)}</div>}
          {(depth === "evidence" || depth === "code") && <div className="mt-4 space-y-4">{(depth === "evidence" ? itemEvidence : itemCode)?.length ? <ul className="list-disc space-y-2 pl-5 text-sm">{(depth === "evidence" ? itemEvidence : itemCode)?.map((entry, index) => <li key={index}><Prose text={entry}/></li>)}</ul> : (depth === "evidence" ? evidence : code).length ? (depth === "evidence" ? evidence : code).map(s => <details key={s.id} className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium">{s.title}</summary><div className="mt-3"><Prose text={s.body}/></div></details>) : <p className="text-sm text-muted-foreground">No {depth === "code" ? "curated code excerpt" : "specific evidence"} was published for this item. Ask the agent before relying on an unsupported claim.</p>}</div>}
          {depth === "artifact" && <div className="mt-4 space-y-4"><p className="text-xs text-muted-foreground">Revision {short(version)} · read-only reference</p>{current.markdown ? <Prose text={current.markdown}/> : <><Prose text={current.recommendation}/>{sections.map(s => <section key={s.id} className="border-t pt-3"><h3 className="font-medium">{s.title}</h3><Prose text={s.body}/></section>)}</>}</div>}
          {depth === "discussion" && <div className="mt-4"><Thread messages={comments} version={version}/><form onSubmit={send} className="mt-5 space-y-3"><label className="text-sm font-medium" htmlFor="question">Ask or challenge this item</label><Textarea id="question" ref={editor} value={draft} onChange={e => updateDraft(e.target.value)} maxLength={20000} rows={3} placeholder="What would change your recommendation?"/><p className="text-xs text-muted-foreground">Draft saved locally. Replies stay on this subject and never resolve it automatically.</p>{draft && draftVersion !== version && <div className="border-l-2 pl-3 text-sm">This draft was written for revision {short(draftVersion)}. Check its subject before sending. <Button type="button" size="sm" variant="outline" onClick={() => { setDraftVersion(version); if (workspace) save(workspace.workspace, `version:${item.subject}`, version) }}>I rechecked this anchor</Button></div>}<Button type="submit" disabled={!workspace?.active || !!error || busy || !draft.trim() || draftVersion !== version}>Send to agent</Button></form></div>}
        </section>}
      </div>}
      <div className="mt-10 flex justify-between border-t pt-4 text-xs"><button className="quiet-link" onClick={previous} disabled={item.id === entries[0]?.id}><ArrowLeft size={14}/> Previous</button><span className="text-muted-foreground">{entries.findIndex(i => i.id === item.id) + 1} / {entries.length}</span><button className="quiet-link" onClick={next} disabled={item.id === entries.at(-1)?.id}>Next <ArrowRight size={14}/></button></div>
    </main>
    <Dialog open={queue} onOpenChange={setQueue}><DialogContent><DialogHeader><DialogTitle>Review queue</DialogTitle><DialogDescription>{open} decisions left · {blockers} blockers · {waiting} questions waiting. Jumping never resolves an item.</DialogDescription></DialogHeader><div className="max-h-[60vh] overflow-auto divide-y">{entries.map(i => <button key={i.id} className="queue-item" onClick={() => choose(i.id)}><span>{i.done ? <Check size={16}/> : i.kind === "question" ? <MessageCircle size={16}/> : <ArrowRight size={16}/>}</span><span className="flex-1"><strong>{i.title}</strong><small>{i.done ? "Done" : i.kind === "question" ? "Waiting" : i.kind === "revision" ? "Inspect before applying" : "Ready"}</small></span></button>)}</div></DialogContent></Dialog>
    <Dialog open={palette} onOpenChange={setPalette}><DialogContent><DialogHeader><DialogTitle>Jump to an item</DialogTitle><DialogDescription>Ctrl/⌘ K · J/↓ next · K/↑ previous · Enter accept · A ask · D alternative · ? why · E evidence · C code</DialogDescription></DialogHeader><div className="flex items-center gap-2 border-b"><Search size={16}/><input autoFocus className="w-full bg-transparent py-2 text-sm outline-none" aria-label="Find an item" placeholder="Find a decision or action" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="max-h-[50vh] overflow-auto divide-y">{entries.filter(i => i.title.toLowerCase().includes(query.toLowerCase())).map(i => <button key={i.id} className="queue-item" onClick={() => { choose(i.id); setQuery("") }}><span className="flex-1">{i.title}</span><ArrowRight size={16}/></button>)}</div></DialogContent></Dialog>
    <Dialog open={review} onOpenChange={setReview}><DialogContent><DialogHeader><DialogTitle>Submit review</DialogTitle><DialogDescription>Exact {phase === "spec" ? "spec" : "candidate"} revision {short(version)}. Approval does not start another phase. {waiting} question{waiting === 1 ? "" : "s"} waiting; {open} consequential decision{open === 1 ? "" : "s"} open.</DialogDescription></DialogHeader><form onSubmit={submitReview} className="space-y-4"><fieldset className="space-y-2"><legend className="sr-only">Review outcome</legend>{([ ["comment", "Comment without approval"], ["request_changes", "Request changes"], ["approve", "Approve exact target"] ] as const).map(([id, label]) => <label key={id} className="flex items-center gap-3 text-sm"><input type="radio" name="outcome" value={id} checked={outcome === id} disabled={(id === "approve" && !canApprove) || (id === "request_changes" && !canRequest)} onChange={() => setOutcome(id)}/>{label}</label>)}</fieldset>{!canApprove && <p className="text-xs text-muted-foreground">Approval unavailable: {workspace?.gate || "No current target"}{open ? ` · ${open} decisions open` : ""}.</p>}{outcome !== "approve" && <div><label htmlFor="review-text" className="text-sm">{outcome === "request_changes" ? "Required change" : "Comment"}</label><Textarea id="review-text" className="mt-2" value={reviewText} onChange={e => { setReviewText(e.target.value); if (workspace) save(workspace.workspace, "review", e.target.value) }} maxLength={20000} rows={3}/></div>}<DialogFooter><Button type="button" variant="outline" onClick={() => setReview(false)}>Return</Button><Button type="submit" disabled={busy || (outcome === "approve" ? !canApprove : !reviewText.trim() || (outcome === "request_changes" && !canRequest))}>{outcome === "approve" ? "Approve revision" : outcome === "request_changes" ? "Request changes" : "Send comment"}</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={!!confirm} onOpenChange={v => { if (!v) setConfirm(null) }}><DialogContent><DialogHeader><DialogTitle>{confirm?.status === "waived" ? "Waive this risk?" : "Accept this recommendation?"}</DialogTitle><DialogDescription>{decision?.subject}. {decision?.consequence} {phase === "spec" ? "The agent must publish the decision in the durable spec before approval." : "Approval is still separate."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>Keep reviewing</Button><Button disabled={busy} onClick={() => { if (confirm) void act(confirm, confirm.status === "waived" ? "Risk waiver recorded. Moving to the next item." : "Decision recorded. Moving to the next item."); setConfirm(null) }}>Confirm and continue</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
