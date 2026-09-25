import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export function FinishPacket({ current, phase, remaining, blockers, waiting, gate, approved, canApprove, active, onReview, onNext }: { current?: string; phase: "spec" | "review"; remaining: number; blockers: number; waiting: number; gate?: string; approved: boolean; canApprove: boolean; active: boolean; onReview: () => void; onNext: () => void }) {
  return <div className="mt-8 space-y-5"><p className="text-base leading-7">{!current ? "The agent has not published an assessment yet." : approved ? "This exact target is approved. No next phase was started." : remaining ? `${remaining} consequential decision${remaining === 1 ? "" : "s"} remain before approval.` : waiting ? `${waiting} question${waiting === 1 ? "" : "s"} waiting for the agent before approval.` : blockers ? `Approval unavailable: ${gate}.` : "All human-attention items are cleared. Approval remains a separate, explicit action."}</p>
    {current && <div className="border-y py-4 text-sm"><p>{phase === "spec" ? "Spec revision" : "Exact candidate assessment"}: <strong className="font-mono">{current.slice(0, 8)}</strong></p><p className="mt-1 text-muted-foreground">{remaining} decisions remaining · {blockers} blockers · {waiting} questions waiting</p></div>}
    {remaining ? <Button variant="outline" onClick={onNext}>Go to decision <ArrowRight size={15}/></Button> : current && !approved && <Button disabled={!active} onClick={onReview}>{canApprove ? "Approve exact target" : "Comment or request changes"} <ArrowRight size={15}/></Button>}
  </div>
}
