import { ArrowRight, Check, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Prose } from "@/components/prose"
import { AttentionVisual } from "@/components/attention-visual"
import type { Decision } from "@/lib/workspace"

export type Depth = "why" | "architecture" | "evidence" | "code" | "discussion" | "artifact" | null
export function DecisionPacket({ decision, phase, disabled, busy, selectedOption, setSelectedOption, accept, alternative, waive, depth }: { decision: Decision; phase: "spec" | "review"; disabled: boolean; busy: boolean; selectedOption: string; setSelectedOption: (id: string) => void; accept: () => void; alternative: () => void; waive: () => void; depth: (value: Depth) => void }) {
  const selected = decision.options?.find(option => option.id === selectedOption)
  const alternativeSelected = !!selected && selected.id !== decision.recommendedOptionId
  return <div className="mt-8 space-y-7">
    <p className="max-w-2xl text-base leading-7">{decision.summary || decision.consequence}</p>
    {decision.visual && <AttentionVisual visual={decision.visual}/>}
    <section className="recommendation" aria-label="Agent recommendation"><p className="eyebrow">◆ AGENT RECOMMENDATION</p><div className="mt-2 text-base leading-7"><Prose text={decision.recommendation}/></div>{decision.recommendationReason && <p className="mt-2 text-sm text-muted-foreground">{decision.recommendationReason}</p>}{decision.summary && <p className="mt-2 text-sm text-muted-foreground">Tradeoff: {decision.consequence}</p>}</section>
    {decision.status === "open" ? <section className="border-t pt-6"><p className="eyebrow">YOUR DECISION</p>{decision.options && <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Decision options">{decision.options.slice(0, 3).map(option => <button key={option.id} type="button" role="radio" aria-checked={selectedOption === option.id} onClick={() => setSelectedOption(option.id)} className={`decision-option ${selectedOption === option.id ? "option-selected" : ""}`}><span className="flex items-center justify-between gap-2"><strong>{option.label}</strong>{selectedOption === option.id && <Check size={16} aria-hidden="true"/>}</span><span className="mt-2 block text-sm text-muted-foreground">{option.summary}</span>{option.id === decision.recommendedOptionId && <small className="mt-2 block">Agent recommends</small>}</button>)}</div>}
      <div className="mt-5 flex flex-wrap items-center gap-3"><Button disabled={disabled || busy} onClick={alternativeSelected ? alternative : accept}>{alternativeSelected ? "Choose alternative" : "Accept recommendation"} <ArrowRight size={15}/></Button>{phase === "review" && decision.kind === "risk" && <Button variant="outline" disabled={disabled || busy} onClick={waive}>Waive disclosed risk</Button>}</div>{alternativeSelected && <p className="mt-2 text-xs text-muted-foreground">This requests a revised assessment from the agent. It does not accept the recommendation or approve this target.</p>}
    </section> : <p className="border-t pt-5 text-sm"><Check size={16} className="mr-2 inline"/>{decision.status === "waived" ? "Risk waived" : "Recommendation accepted"} on this revision.</p>}
    <div className="border-t pt-5"><p className="eyebrow">NEED MORE CONTEXT?</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-3 text-sm"><button className="quiet-link" onClick={() => depth("why")}>Why does this matter?</button>{decision.context?.architecture && <button className="quiet-link" onClick={() => depth("architecture")}>How does this work?</button>}{!!decision.context?.evidence?.length && <button className="quiet-link" onClick={() => depth("evidence")}>Show evidence</button>}{!!decision.context?.code?.length && <button className="quiet-link" onClick={() => depth("code")}>Show code</button>}<button className="quiet-link" onClick={() => depth("discussion")}><MessageCircle size={14}/> Ask agent</button></div></div>
  </div>
}
