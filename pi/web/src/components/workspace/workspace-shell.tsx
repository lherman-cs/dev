import { Command, Moon, Sun } from "lucide-react"
import type { ReactNode } from "react"
import type { AttentionItem } from "@/lib/attention-items"

export function WorkspaceShell({ children, items, project, phase, summary, dark, toggleTheme, commands, overview, finish }: { children: ReactNode; items: AttentionItem[]; selected: string; onSelect: (id: string) => void; project: string; phase: "spec" | "review"; summary: { remaining: number; cleared: number; total: number; waiting: number; blockers: number }; dark: boolean; toggleTheme: () => void; commands: () => void; overview: () => void; finish: () => void }) {
  const label = phase === "spec" ? "Spec" : "Review"
  return <div className="min-h-screen bg-background text-foreground">
    <header className="workspace-topbar"><div className="flex min-w-0 items-center gap-2"><span className="brand-mark" aria-hidden="true">◆</span><strong>Dev {label}</strong><span className="text-muted-foreground">/</span><span className="truncate text-muted-foreground">{project}</span></div>
      <div className="flex shrink-0 items-center gap-2"><button type="button" className="quiet-link hidden sm:inline-flex" onClick={overview}>Overview</button><button type="button" className="icon-button" aria-label="Open commands" title="Commands · Ctrl/⌘ K" onClick={commands}><Command size={17}/></button><button type="button" className="icon-button" aria-label={dark ? "Use light theme" : "Use dark theme"} onClick={toggleTheme}>{dark ? <Sun size={17}/> : <Moon size={17}/>}</button>{items.some(item => item.kind === "finish" && item.title !== "Waiting for the agent") && <button type="button" className="quiet-link hidden sm:inline-flex" onClick={finish}>Final {label.toLowerCase()}</button>}</div>
    </header>
    <main className="workspace-main"><div className="workspace-canvas"><div className="mb-8 flex flex-wrap items-center justify-between gap-2 border-b pb-4 text-sm text-muted-foreground"><span aria-label="Remaining work">{summary.remaining} decision{summary.remaining === 1 ? "" : "s"} to answer{summary.blockers > 0 ? ` · ${summary.blockers} blocker${summary.blockers === 1 ? "" : "s"}` : ""}{summary.waiting > 0 ? ` · ${summary.waiting} waiting` : ""}</span><button className="quiet-link sm:hidden" type="button" onClick={overview}>Overview</button></div>{children}</div></main>
  </div>
}
