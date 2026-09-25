import { ArrowRight } from "lucide-react"
import type { AttentionVisual as Visual, VisualNode, VisualEdge } from "@/lib/workspace"

function Graph({ nodes, edges, label }: { nodes: VisualNode[]; edges: VisualEdge[]; label: string }) {
  const names = new Map(nodes.map(node => [node.id, node.label]))
  return <div className="visual" role="group" aria-label={label}>
    <div className="grid gap-2 sm:grid-cols-2">{nodes.slice(0, 7).map(node => <div key={node.id} className={`visual-node ${node.emphasis === "warning" ? "visual-warning" : node.emphasis === "primary" ? "visual-primary" : ""}`}><strong>{node.label}</strong>{node.sublabel && <small>{node.sublabel}</small>}{node.group && <small>{node.group}</small>}</div>)}</div>
    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{edges.map((edge, i) => <li key={i}>{names.get(edge.from) || edge.from} → {names.get(edge.to) || edge.to}{edge.label && ` · ${edge.label}`}</li>)}</ul>
  </div>
}
function BeforeAfter({ before, after, label }: { before: string | { title?: string; summary: string; items?: string[] }; after: string | { title?: string; summary: string; items?: string[] }; label: string }) {
  const panels = [before, after].map(value => typeof value === "string" ? { summary: value } : value)
  return <div className="visual grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center" role="group" aria-label={label}>
    {panels.map((panel, i) => <div key={i} className="visual-node"><p className="eyebrow">{panel.title || (i ? "AFTER" : "BEFORE")}</p><p className="mt-2">{panel.summary}</p>{panel.items && <ul className="mt-2 list-disc pl-4 text-muted-foreground">{panel.items.map(item => <li key={item}>{item}</li>)}</ul>}</div>).reduce<React.ReactNode[]>((result, panel, i) => [...result, ...(i ? [<ArrowRight key="arrow" size={16} aria-hidden="true"/>] : []), panel], [])}
  </div>
}
export function AttentionVisual({ visual }: { visual: Visual }) {
  if (visual.type === "option_comparison") return <div className="visual grid gap-3 sm:grid-cols-2" role="group" aria-label="Options and tradeoffs">
    {visual.options.slice(0, 3).map((option, index) => <div key={option.id || index} className="visual-node"><h2 className="font-semibold">{option.label}{option.recommended && <span className="ml-2 text-xs text-accent-foreground">Recommended</span>}</h2>{option.summary && <p className="mt-2">{option.summary}</p>}{[...(option.benefits || (option.benefit ? [option.benefit] : []))].map((text, i) => <p key={`b${i}`} className="mt-1 text-xs">+ {text}</p>)}{[...(option.costs || (option.cost ? [option.cost] : []))].map((text, i) => <p key={`c${i}`} className="mt-1 text-xs text-muted-foreground">− {text}</p>)}</div>)}
  </div>
  if (visual.type === "architecture_graph") return <Graph nodes={visual.nodes} edges={visual.edges} label="Architecture relationships"/>
  if (visual.type === "state_machine" && "states" in visual) return <Graph nodes={visual.states} edges={visual.transitions} label="State transitions"/>
  if ((visual.type === "sequence_flow" || visual.type === "dependency_path") && "nodes" in visual) return <Graph nodes={visual.nodes} edges={visual.edges} label={visual.type.replace(/_/g, " ")}/>
  if ("steps" in visual) return <ol className="visual flex flex-wrap items-center gap-2" aria-label={visual.type.replace(/_/g, " ")}>
    {visual.steps.slice(0, 7).map((step, index) => <li key={index} className="flex items-center gap-2">{index > 0 && <ArrowRight size={15} aria-hidden="true" className="text-muted-foreground"/>}<span className="visual-node">{typeof step === "string" ? step : <><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</>}</span></li>)}
  </ol>
  if ("before" in visual) return <BeforeAfter before={visual.before} after={visual.after} label={visual.type.replace(/_/g, " ")}/>
  return null
}
