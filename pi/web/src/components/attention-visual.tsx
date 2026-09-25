import { ArrowRight } from "lucide-react"
import type { AttentionVisual as Visual } from "@/lib/workspace"

export function AttentionVisual({ visual }: { visual: Visual }) {
  if (visual.type === "option_comparison") return <div className="grid gap-3 sm:grid-cols-2" aria-label="Options and tradeoffs">
    {visual.options.map((option, index) => <div key={index} className="border p-4 text-sm">
      <h2 className="font-semibold">{option.label}</h2>
      <p className="mt-2"><span className="text-muted-foreground">Benefit: </span>{option.benefit}</p>
      <p className="mt-1"><span className="text-muted-foreground">Cost: </span>{option.cost}</p>
    </div>)}
  </div>
  if ("steps" in visual) return <ol className="flex flex-wrap items-center gap-2 border-y py-4 text-sm" aria-label={visual.type.replace(/_/g, " ")}>
    {visual.steps.map((step, index) => <li key={index} className="flex items-center gap-2">
      {index > 0 && <ArrowRight size={15} aria-hidden="true" className="text-muted-foreground"/>}
      <span className="border px-3 py-2">{step}</span>
    </li>)}
  </ol>
  return <div className="grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center" aria-label={visual.type.replace(/_/g, " ")}>
    <div className="border p-4"><p className="eyebrow">BEFORE</p><p className="mt-2">{visual.before}</p></div>
    <ArrowRight size={16} aria-hidden="true" className="text-muted-foreground"/>
    <div className="border p-4"><p className="eyebrow">AFTER</p><p className="mt-2">{visual.after}</p></div>
  </div>
}
