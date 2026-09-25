import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRight, Check, Command, FileCode2, GitBranch, List,
  MessageCircle, Search, ShieldAlert, Sparkles, X
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Prose } from "@/components/prose"
import { AttentionVisual } from "@/components/attention-visual"
import { loadWorkspace, request, type Action, type Discussion, type Document, type Workspace } from "@/lib/workspace"

type Item = { id: string; kind: "revision" | "decision" | "question" | "finish"; title: string; subject: string; done: boolean }
type Drawer = "why" | "architecture" | "evidence" | "code" | "discussion" | null
type Outcome = "comment" | "request_changes" | "approve"

const short = (id?: string) => id?.slice(0, 8) || "unassessed"
const storageKey = (space: string, subject: string) => `dev-workspace:${space}:${subject}`
function saved(space: string, subject: string, fallback = "") {
  try { return localStorage.getItem(storageKey(space, subject)) ?? fallback } catch { return fallback }
}
function save(space: string, subject: string, value: string) {
  try { localStorage.setItem(storageKey(space, subject), value) } catch { /* server copy may still exist */ }
}

function itemsFor(workspace: Workspace | null): Item[] {
  const doc = workspace?.state.current
  const pending = workspace?.state.pending
  const items: Item[] = []
  if (pending) items.push({ id: `revision:${pending.version}`, kind: "revision", title: "Inspect the proposed revision", subject: pending.version, done: false })
  if (doc) {
    for (const d of [...doc.decisions].sort((a, b) => Number(b.kind === "risk") - Number(a.kind === "risk"))) {
      items.push({ id: `decision:${d.id}`, kind: "decision", title: d.subject, subject: d.id, done: d.status !== "open" })
    }
    for (const m of workspace!.state.discussions.filter(m => m.author === "human" && m.status === "queued" && m.version === doc.version)) {
      items.push({ id: `question:${m.id}`, kind: "question", title: `Waiting for agent: ${doc.sections.find(s => s.id === m.subject)?.title || doc.decisions.find(d => d.id === m.subject)?.subject || "review question"}`, subject: m.subject, done: false })
    }
  }
  items.push({ id: "finish", kind: "finish", title: doc ? "Finish the review" : "Await the first assessment", subject: "general", done: !doc || Boolean(workspace?.state.approval?.version === doc.version && workspace.canApprove) })
  return items
}

function Thread({ messages, version }: { messages: Discussion[]; version: string }) {
  return <div className="thread-list">
    {messages.length ? messages.map(m => <div key={m.id} className="thread-message">
      <div className={m.author === "human" ? "thread-avatar human" : "thread-avatar"}>{m.author === "human" ? "Y" : "A"}</div>
      <div>
        <div className="thread-meta"><strong>{m.author === "human" ? "You" : "Agent"}</strong><span>·</span><span>{m.version === version ? "current revision" : `revision ${short(m.version)}`}</span>{m.status && <><span>·</span><span>{m.status}</span></>}</div>
        <div className="thread-copy"><Prose text={m.text} /></div>
      </div>
    </div>) : <p className="context-copy">No discussion yet. Ask the agent about this exact decision.</p>}
  </div>
}

function Changes({ current, pending }: { current?: Document; pending: Document }) {
  const changed = pending.sections.filter(s => !current?.sections.some(old => old.id === s.id && old.title === s.title && old.body === s.body))
  const removed = current?.sections.filter(s => !pending.sections.some(next => next.id === s.id)) || []
  return <div className="space-y-5 text-sm">
    {current?.recommendation !== pending.recommendation && <div><h3 className="font-medium">Recommendation changed</h3><p className="mt-2 text-muted-foreground">Before: {current?.recommendation || "None"}</p><div className="mt-2"><Prose text={pending.recommendation} /></div></div>}
    {changed.map(s => <section key={s.id} className="border-t pt-4"><h3 className="font-medium">{s.title}</h3>{current?.sections.find(old => old.id === s.id) && <div className="mt-2 border-l-2 pl-3 text-muted-foreground"><p className="text-xs">Before</p><Prose text={current.sections.find(old => old.id === s.id)!.body} /></div>}<div className="mt-2 border-l-2 border-foreground pl-3"><p className="text-xs text-muted-foreground">Proposed</p><Prose text={s.body} /></div></section>)}
    {removed.map(s => <p key={s.id} className="border-t pt-3">Removed: {s.title}</p>)}
    {!changed.length && !removed.length && current?.recommendation === pending.recommendation && <p>Artifact, candidate, or decision state changed. Inspect the proposed artifact before applying.</p>}
  </div>
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [focusId, setFocusId] = useState("")
  const [drawer, setDrawer] = useState<Drawer>("why")
  const [queueOpen, setQueueOpen] = useState(false)
  const [palette, setPalette] = useState(false)
  const [query, setQuery] = useState("")
  const [finishOpen, setFinishOpen] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>("comment")
  const [reviewText, setReviewText] = useState("")
  const [draft, setDraft] = useState("")
  const [draftSubject, setDraftSubject] = useState("")
  const [draftVersion, setDraftVersion] = useState("")
  const [inspected, setInspected] = useState("")
  const [confirm, setConfirm] = useState<Action | null>(null)
  const sequence = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const initialized = useRef("")

  const refresh = useCallback(async () => {
    const n = ++sequence.current
    try {
      const data = await loadWorkspace()
      if (sequence.current === n) { setWorkspace(data); setError("") }
    } catch (e) {
      if (sequence.current === n) setError(e instanceof Error ? e.message : "Workspace disconnected")
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => { clearInterval(timer); sequence.current++ }
  }, [refresh])

  const current = workspace?.state.current
  const pending = workspace?.state.pending
  const version = current?.version || "unassessed"
  const phase = workspace?.phase || "spec"
  const entries = useMemo(() => itemsFor(workspace), [workspace])
  const defaultItem = entries.find(i => !i.done && i.kind === "revision") || entries.find(i => !i.done) || entries.at(-1)!
  const item = entries.find(i => i.id === focusId) || defaultItem
  const decision = current?.decisions.find(d => item.kind === "decision" && d.id === item.subject)
  const comments = workspace?.state.discussions.filter(m => m.subject === item.subject) || []
  const open = current?.decisions.filter(d => d.status === "open").length || 0
  const waiting = workspace?.state.discussions.filter(m => m.author === "human" && m.status === "queued" && m.version === version).length || 0
  const blockers = Number(Boolean(pending)) + Number(Boolean(decision?.kind === "risk" && decision.status === "open"))
  const actionable = entries.filter(i => i.kind !== "question" && i.kind !== "finish")
  const doneCount = actionable.filter(i => i.done).length
  const progress = actionable.length ? Math.round((doneCount / actionable.length) * 100) : (current ? 100 : 0)
  const index = Math.max(0, entries.findIndex(i => i.id === item.id))
  const canApprove = Boolean(workspace?.active && workspace.canApprove && !pending && !error && workspace.state.approval?.version !== version)
  const canDecide = Boolean(workspace?.active && !pending && !error && (workspace.gate === "Current candidate" || workspace.gate === "Current spec" || workspace.gate === "Resolve consequential decisions"))
  const canRequest = Boolean(workspace?.active && current && !pending && !error)

  useEffect(() => {
    if (!workspace || initialized.current === workspace.workspace) return
    initialized.current = workspace.workspace
    setReviewText(saved(workspace.workspace, "review"))
  }, [workspace?.workspace])

  useEffect(() => {
    if (!workspace || draftSubject === item.subject) return
    setDraftSubject(item.subject)
    setDraft(saved(workspace.workspace, item.subject, workspace.state.drafts[item.subject] || ""))
    setDraftVersion(saved(workspace.workspace, `version:${item.subject}`, version))
  }, [workspace?.workspace, item.subject, draftSubject, version])

  useEffect(() => {
    if (!workspace || !draft || draftSubject !== item.subject || draftVersion !== version) return
    const timer = window.setTimeout(() => { void request({ action: "draft", subject: item.subject, text: draft, version }).catch(() => {}) }, 600)
    return () => clearTimeout(timer)
  }, [workspace?.workspace, draft, draftSubject, draftVersion, item.subject, version])

  const updateDraft = (value: string) => {
    if (!workspace) return
    setDraft(value); setDraftVersion(version)
    save(workspace.workspace, item.subject, value)
    save(workspace.workspace, `version:${item.subject}`, version)
  }

  function choose(id: string) {
    setFocusId(id); setDrawer(null); setQueueOpen(false); setPalette(false)
    window.setTimeout(() => heading.current?.focus(), 0)
  }
  function next() { choose(entries[Math.min(index + 1, entries.length - 1)]!.id) }
  function previous() { choose(entries[Math.max(0, index - 1)]!.id) }

  async function act(action: Action, success: string) {
    setBusy(true)
    try {
      await request(action)
      setNotice(success); setError(""); setFocusId(""); setDrawer(null); setInspected("")
      await refresh()
      window.setTimeout(() => heading.current?.focus(), 0)
    } catch (e) {
      setNotice(`Not completed: ${e instanceof Error ? e.message : String(e)}. No automatic retry.`)
      await refresh()
    } finally { setBusy(false) }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (!draft.trim() || !workspace || busy || draftVersion !== version) return
    setBusy(true)
    try {
      await request({ action: "submit", subject: item.subject, text: draft, version })
      setNotice("Question sent. The decision remains open until you resolve it.")
      setDraft(""); save(workspace.workspace, item.subject, "")
      await refresh()
    } catch (e) {
      setNotice(`Delivery uncertain or failed: ${String(e)}. Draft retained.`)
      await refresh()
    } finally { setBusy(false) }
  }

  async function submitReview(event: React.FormEvent) {
    event.preventDefault()
    if (busy || (outcome === "approve" ? !canApprove : !reviewText.trim()) || (outcome === "request_changes" && !canRequest)) return
    const action: Action = { action: outcome === "comment" ? "submit" : outcome, subject: "general", text: reviewText, version }
    setBusy(true)
    try {
      await request(action)
      setFinishOpen(false)
      setNotice(outcome === "approve" ? "Approved this exact revision." : outcome === "request_changes" ? "Changes requested. Await a new revision." : "Comment sent.")
      setReviewText("")
      if (workspace) save(workspace.workspace, "review", "")
      await refresh()
    } catch (e) {
      setNotice(`Review delivery uncertain or failed: ${String(e)}. Text retained.`)
      await refresh()
    } finally { setBusy(false) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(v => !v); return }
      const target = e.target as HTMLElement
      if (target.closest("input,textarea,[contenteditable=true],[role=dialog]") || e.altKey || e.metaKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === "j" || k === "arrowdown") { e.preventDefault(); next() }
      if (k === "k" || k === "arrowup") { e.preventDefault(); previous() }
      if (k === "w" || k === "?") setDrawer("why")
      if (k === "e") setDrawer("evidence")
      if (k === "c") setDrawer("code")
      if (k === "a") { setDrawer("discussion"); window.setTimeout(() => editor.current?.focus(), 0) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const sectionMatches = (pattern: RegExp) => (current?.sections || []).filter(s => pattern.test(`${s.kind} ${s.title}`))
  const evidenceSections = sectionMatches(/evidence|validation|outcome|risk/i)
  const codeSections = sectionMatches(/code|implementation|architecture|system/i)

  const drawerContent = () => {
    if (!current) return <p className="context-copy">The agent has not published an assessment yet.</p>
    if (drawer === "why") return <>
      <div className="context-card"><div className="context-label">Minimum mental model</div><div className="context-title">{decision?.context?.mentalModel || decision?.consequence || current.recommendation}</div><div className="context-copy">{decision?.context?.explanation || "This is the smallest amount of context needed to judge the current item confidently."}</div></div>
      {decision && <div className="context-card"><div className="context-label">Agent position</div><div className="context-copy">{decision.recommendation}</div></div>}
    </>
    if (drawer === "architecture") return <>
      <div className="context-card"><div className="context-label">How this fits</div><div className="context-copy">{decision?.context?.architecture || (phase === "spec" ? "The agent publishes a durable spec revision; your decisions become inputs to the next revision before approval." : "The assessment is bound to an exact candidate. Decisions and approval apply only to that exact target.")}</div><div className="context-chain"><span>goal</span><b>→</b><span>agent work</span><b>→</b><span>review</span><b>→</b><span>decision</span></div></div>
      {codeSections.map(s => <details className="context-card" key={s.id}><summary>{s.title}</summary><div className="context-copy mt-2"><Prose text={s.body}/></div></details>)}
    </>
    if (drawer === "evidence") return <>
      {(decision?.context?.evidence?.length ? decision.context.evidence : evidenceSections.map(s => s.body)).map((entry, i) => <div className="context-card" key={i}><div className="context-label">Evidence {i + 1}</div><div className="context-copy"><Prose text={entry}/></div></div>)}
      {!decision?.context?.evidence?.length && !evidenceSections.length && <p className="context-copy">No specific evidence was published for this item. Ask the agent before relying on an unsupported claim.</p>}
    </>
    if (drawer === "code") return <>
      {(decision?.context?.code?.length ? decision.context.code : codeSections.map(s => s.body)).map((entry, i) => <div className="context-card" key={i}><div className="context-label">Relevant code {i + 1}</div><div className="context-copy"><Prose text={entry}/></div></div>)}
      {!decision?.context?.code?.length && !codeSections.length && <p className="context-copy">No curated code excerpt was published for this item.</p>}
    </>
    return <Thread messages={comments} version={version}/>
  }

  const drawerTitle = drawer === "why" ? "Why this matters" : drawer === "architecture" ? "Subsystem mental model" : drawer === "evidence" ? "Evidence" : drawer === "code" ? "Relevant code" : "Discussion"

  return <div className="review-app">
    <header className="review-topbar">
      <div className="review-brand"><span className="review-brandmark">◆</span><span>Dev Review</span></div>
      <div className="review-crumb">{workspace?.project || "Workspace"} <span>/</span> {phase === "spec" ? "Spec" : "Review"}</div>
      <div className="review-top-spacer"/>
      <div className="review-progress-summary"><span>{open} decision{open === 1 ? "" : "s"} remaining · {blockers} blocker{blockers === 1 ? "" : "s"}</span><div className="review-progress-track"><span style={{ width: `${progress}%` }}/></div></div>
      <button className="review-top-button" onClick={() => setPalette(true)}><Command size={14}/> K</button>
      <button className="review-top-button primary" onClick={() => { setOutcome(canApprove ? "approve" : "comment"); setFinishOpen(true) }}>Finish review</button>
    </header>

    <div className="review-shell">
      <aside className="review-rail" aria-label="Review path">
        {entries.slice(0, 5).map((entry, i) => <button key={entry.id} className={`review-step ${entry.done ? "done" : ""} ${entry.id === item.id ? "active" : ""} ${entry.kind === "decision" && current?.decisions.find(d => d.id === entry.subject)?.kind === "risk" && !entry.done ? "block" : ""}`} onClick={() => choose(entry.id)} aria-label={entry.title}>
          {entry.done ? <Check size={14}/> : <span>{i + 1}</span>}
        </button>)}
        <button className="review-rail-list" onClick={() => setQueueOpen(true)} aria-label="Open review queue"><List size={16}/></button>
      </aside>

      <div className={`review-main ${drawer ? "drawer-open" : ""}`}>
        <main className="review-content">
          <div className="review-inner">
            <div className="review-overview-row">
              <span className="review-badge">Review {index + 1} of {entries.length}</span>
              {item.kind === "decision" && decision?.kind === "risk" && decision.status === "open" && <span className="review-badge danger">Blocks approval</span>}
              {pending && item.kind === "revision" && <span className="review-badge warning">Revision waiting</span>}
              <span className="review-estimate">{item.kind === "decision" ? "Focus on one decision" : "One step at a time"}</span>
            </div>

            <div className="review-kicker">{item.kind === "revision" ? "REVISION TO INSPECT" : item.kind === "decision" ? "NEXT DECISION" : item.kind === "question" ? "WAITING FOR AGENT" : "FINISH LINE"}</div>
            <h1 ref={heading} tabIndex={-1}>{item.title}</h1>

            {item.kind === "decision" && decision && <>
              <p className="review-lead">{decision.consequence}</p>

              <div className="review-visual-block">
                <div className="review-visual-heading"><span>Why this decision exists</span><span>Relevant context only</span></div>
                {decision.visual ? <AttentionVisual visual={decision.visual}/> : <div className="review-fallback-flow" role="img" aria-label="Decision context flow"><span>Requested outcome</span><ArrowRight size={16}/><span>{decision.kind === "risk" ? "Risk discovered" : "Choice required"}</span><ArrowRight size={16}/><span>Your decision</span></div>}
              </div>

              {decision.context?.mentalModel && <div className="review-mental"><strong>Mental model:</strong> {decision.context.mentalModel}</div>}

              <section className="review-section">
                <div className="review-section-head"><h2>Agent recommendation</h2><span>decision brief</span></div>
                <div className="review-recommendation">
                  <div className="review-agent-avatar"><Sparkles size={14}/></div>
                  <div><strong>{decision.recommendation}</strong><p>{decision.kind === "risk" ? "Treat this as a disclosed risk: inspect enough evidence to decide whether to require a change or consciously waive it." : "Use the deeper context only if this summary is not enough to decide confidently."}</p></div>
                </div>
              </section>

              <section className="review-section">
                <div className="review-section-head"><h2>Your decision</h2></div>
                <div className="review-choice-grid">
                  <button className="review-choice selected" disabled={decision.status !== "open" || !canDecide || busy} onClick={() => setConfirm({ action: "decide", id: decision.id, status: "accepted", version })}>
                    <span className="review-choice-check"><Check size={12}/></span>
                    <strong>Accept recommendation</strong>
                    <span>Adopt the agent's proposed direction for this exact revision.</span>
                  </button>
                  {phase === "review" && decision.kind === "risk" ? <button className="review-choice" disabled={decision.status !== "open" || !canDecide || busy} onClick={() => setConfirm({ action: "decide", id: decision.id, status: "waived", version })}>
                    <span className="review-choice-check"/>
                    <strong>Waive disclosed risk</strong>
                    <span>Keep the implementation while explicitly accepting this risk.</span>
                  </button> : <button className="review-choice" onClick={() => { setDrawer("discussion"); window.setTimeout(() => editor.current?.focus(), 0) }}>
                    <span className="review-choice-check"/>
                    <strong>Choose differently</strong>
                    <span>Challenge the recommendation or tell the agent what should change.</span>
                  </button>}
                </div>
                <div className="review-actions">
                  <Button disabled={decision.status !== "open" || !canDecide || busy} onClick={() => setConfirm({ action: "decide", id: decision.id, status: "accepted", version })}>Accept recommendation <ArrowRight size={15}/></Button>
                  <Button variant="outline" onClick={() => { setDrawer("discussion"); window.setTimeout(() => editor.current?.focus(), 0) }}>Ask agent</Button>
                  <button className="review-text-action" onClick={() => setDrawer("architecture")}>Compare / understand more</button>
                  <button className="review-next" onClick={next}>Next unresolved <ArrowRight size={14}/></button>
                </div>
                <div className="review-drill">
                  <button onClick={() => setDrawer("why")}>Why does this matter?</button>
                  <button onClick={() => setDrawer("code")}><FileCode2 size={13}/> Show code</button>
                  <button onClick={() => setDrawer("evidence")}><ShieldAlert size={13}/> Show evidence</button>
                  <button onClick={() => setDrawer("architecture")}><GitBranch size={13}/> How does this subsystem work?</button>
                </div>
              </section>
            </>}

            {item.kind === "revision" && pending && <>
              <p className="review-lead">The agent published a new {phase === "spec" ? "specification" : "assessment"}. Inspect what changed, then apply it explicitly. Applying is not approval.</p>
              <div className="review-visual-block"><div className="review-fallback-flow"><span>Current {short(version)}</span><ArrowRight size={16}/><span>Inspect {short(pending.version)}</span><ArrowRight size={16}/><span>Apply</span><ArrowRight size={16}/><span>Continue review</span></div></div>
              <details className="review-details" onToggle={e => { if (e.currentTarget.open) setInspected(pending.version) }}><summary>Inspect changed subjects</summary><div className="mt-5"><Changes current={current} pending={pending}/></div></details>
              <div className="review-actions"><Button disabled={busy || inspected !== pending.version || !!error} onClick={() => void act({ action: "apply", version }, "Revision applied. Moving to the new target.")}>Apply inspected revision <ArrowRight size={15}/></Button>{inspected !== pending.version && <span className="review-estimate">Open changed subjects first</span>}<button className="review-next" onClick={next}>Next <ArrowRight size={14}/></button></div>
            </>}

            {item.kind === "question" && <>
              <p className="review-lead">Your question is with the agent. You do not need to wait here; the answer will stay attached to this subject.</p>
              <div className="review-thread-inline"><Thread messages={comments} version={version}/></div>
              <div className="review-actions"><Button variant="outline" onClick={next}>Continue reviewing <ArrowRight size={15}/></Button></div>
            </>}

            {item.kind === "finish" && <>
              <p className="review-lead">{!current ? "The agent has not published an assessment yet." : open ? `Resolve ${open} consequential decision${open === 1 ? "" : "s"} before approval.` : waiting ? `There ${waiting === 1 ? "is" : "are"} ${waiting} unanswered agent question${waiting === 1 ? "" : "s"}.` : "All review items are clear. Submit the overall review outcome for this exact revision."}</p>
              <div className="review-finish-card">
                <div><strong>Finish line</strong><p>{open} decisions remaining · {blockers} blockers unresolved · {waiting} questions waiting</p></div>
                <Button onClick={() => { setOutcome(canApprove ? "approve" : "comment"); setFinishOpen(true) }}>{canApprove ? `Approve ${phase}` : "Submit review"} <ArrowRight size={15}/></Button>
              </div>
            </>}

            {(notice || error || workspace?.state.notice) && <div className="review-notice" role="status">{error || notice || workspace?.state.notice}</div>}

            <div className="review-finish-strip">
              <div><strong>Finish line</strong><span>{open} decisions remaining · {blockers} blockers unresolved · {waiting} questions waiting</span></div>
              <div className="review-dots">{entries.slice(0, 7).map((e, i) => <span key={e.id} className={e.done ? "done" : i === index ? "active" : ""}/>)}</div>
            </div>
          </div>
        </main>

        <aside className="review-context-drawer" aria-hidden={!drawer}>
          <div className="review-context-inner">
            <div className="review-context-head"><strong>{drawerTitle}</strong><button onClick={() => setDrawer(null)}><X size={17}/></button></div>
            <div className="review-context-tabs">
              <button className={drawer === "why" ? "active" : ""} onClick={() => setDrawer("why")}>Explain</button>
              <button className={drawer === "evidence" ? "active" : ""} onClick={() => setDrawer("evidence")}>Evidence</button>
              <button className={drawer === "code" ? "active" : ""} onClick={() => setDrawer("code")}>Code</button>
              <button className={drawer === "discussion" ? "active" : ""} onClick={() => setDrawer("discussion")}>Thread</button>
            </div>
            <div className="review-context-body">{drawerContent()}</div>
            {current && <form className="review-composer" onSubmit={send}>
              <Textarea ref={editor} value={draft} onChange={e => updateDraft(e.target.value)} rows={3} placeholder="Ask the agent about this exact context…" />
              <div><span>Context stays attached to this item</span><Button size="sm" type="submit" disabled={!workspace?.active || !!error || busy || !draft.trim() || draftVersion !== version}>Send</Button></div>
            </form>}
          </div>
        </aside>
      </div>
    </div>

    <Dialog open={queueOpen} onOpenChange={setQueueOpen}><DialogContent><DialogHeader><DialogTitle>Review queue</DialogTitle><DialogDescription>Jump anywhere. Nothing is resolved by navigation.</DialogDescription></DialogHeader><div className="max-h-[60vh] overflow-auto divide-y">{entries.map(i => <button key={i.id} className="queue-item" onClick={() => choose(i.id)}><span>{i.done ? <Check size={16}/> : i.kind === "question" ? <MessageCircle size={16}/> : <ArrowRight size={16}/>}</span><span className="flex-1"><strong>{i.title}</strong><small>{i.done ? "Done" : i.kind === "question" ? "Waiting" : "Needs attention"}</small></span></button>)}</div></DialogContent></Dialog>

    <Dialog open={palette} onOpenChange={setPalette}><DialogContent><DialogHeader><DialogTitle>Jump to an item</DialogTitle><DialogDescription>Ctrl/⌘ K · J/↓ next · K/↑ previous · A ask · ? why · E evidence · C code</DialogDescription></DialogHeader><div className="flex items-center gap-2 border-b"><Search size={16}/><input autoFocus className="w-full bg-transparent py-2 text-sm outline-none" aria-label="Find an item" placeholder="Find a decision or action" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="max-h-[50vh] overflow-auto divide-y">{entries.filter(i => i.title.toLowerCase().includes(query.toLowerCase())).map(i => <button key={i.id} className="queue-item" onClick={() => { choose(i.id); setQuery("") }}><span className="flex-1">{i.title}</span><ArrowRight size={16}/></button>)}</div></DialogContent></Dialog>

    <Dialog open={finishOpen} onOpenChange={setFinishOpen}><DialogContent><DialogHeader><DialogTitle>Submit review</DialogTitle><DialogDescription>Exact {phase === "spec" ? "spec" : "candidate"} revision {short(version)}. Approval does not start another phase.</DialogDescription></DialogHeader><form onSubmit={submitReview} className="space-y-4"><fieldset className="space-y-2"><legend className="sr-only">Review outcome</legend>{([["comment","Comment without approval"],["request_changes","Request changes"],["approve","Approve exact target"]] as const).map(([id,label]) => <label key={id} className="flex items-center gap-3 text-sm"><input type="radio" name="outcome" value={id} checked={outcome===id} disabled={(id==="approve"&&!canApprove)||(id==="request_changes"&&!canRequest)} onChange={()=>setOutcome(id)}/>{label}</label>)}</fieldset>{outcome!=="approve" && <Textarea value={reviewText} onChange={e=>{setReviewText(e.target.value);if(workspace)save(workspace.workspace,"review",e.target.value)}} rows={3} placeholder={outcome==="request_changes"?"What must change?":"Optional review comment"}/>}<DialogFooter><Button type="button" variant="outline" onClick={()=>setFinishOpen(false)}>Return</Button><Button type="submit" disabled={busy || (outcome==="approve" ? !canApprove : !reviewText.trim() || (outcome==="request_changes"&&!canRequest))}>{outcome==="approve"?"Approve revision":outcome==="request_changes"?"Request changes":"Send comment"}</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={!!confirm} onOpenChange={v => { if (!v) setConfirm(null) }}><DialogContent><DialogHeader><DialogTitle>{confirm?.status === "waived" ? "Waive this disclosed risk?" : "Accept this recommendation?"}</DialogTitle><DialogDescription>{decision?.subject}. {decision?.consequence} Approval remains a separate action.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>Keep reviewing</Button><Button disabled={busy} onClick={() => { if (confirm) void act(confirm, confirm.status === "waived" ? "Risk waiver recorded. Moving on." : "Decision recorded. Moving on."); setConfirm(null) }}>Confirm and continue</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
