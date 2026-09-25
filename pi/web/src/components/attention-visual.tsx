import { ArrowRight } from "lucide-react"
import type { AttentionVisual as Visual } from "@/lib/workspace"

export function AttentionVisual({ visual }: { visual: Visual }) {
  if (visual.type === "option_comparison") return <div className="attention-options" aria-label="Options and tradeoffs">
    {visual.options.map((option, index) => <div key={index} className="attention-option">
      <h3>{option.label}</h3>
      <p><strong>Benefit:</strong> {option.benefit}</p>
      <p><strong>Cost:</strong> {option.cost}</p>
    </div>)}
  </div>

  if ("steps" in visual) return <ol className="attention-flow" aria-label={visual.type.replace(/_/g, " ")}>
    {visual.steps.map((step, index) => <li key={index}>
      {index > 0 && <ArrowRight size={15} aria-hidden="true" className="text-muted-foreground"/>}
      <span>{step}</span>
    </li>)}
  </ol>

  return <div className="attention-delta" aria-label={visual.type.replace(/_/g, " ")}>
    <div><div className="eyebrow">BEFORE</div><p>{visual.before}</p></div>
    <ArrowRight size={16} aria-hidden="true" className="text-muted-foreground"/>
    <div><div className="eyebrow">AFTER</div><p>{visual.after}</p></div>
  </div>
}
