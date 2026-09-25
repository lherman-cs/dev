import { useEffect, useId, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import DOMPurify from "dompurify"

function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/:/g, "")
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", flowchart: { htmlLabels: false }, suppressErrorRendering: true })
      const rendered = await mermaid.render(`diagram-${id}`, source)
      // Mermaid emits XHTML foreignObject labels even with SVG labels requested. Convert
      // labels to inert SVG text before removing foreignObject markup from untrusted diagrams.
      const parsed = new DOMParser().parseFromString(rendered.svg, "image/svg+xml")
      for (const label of parsed.querySelectorAll("foreignObject")) {
        const text = parsed.createElementNS("http://www.w3.org/2000/svg", "text")
        const width = Number(label.getAttribute("width")) || 100
        const height = Number(label.getAttribute("height")) || 24
        text.setAttribute("x", String(width / 2))
        text.setAttribute("y", String(height / 2))
        text.setAttribute("text-anchor", "middle")
        text.setAttribute("dominant-baseline", "middle")
        text.textContent = label.textContent?.replace(/\s+/g, " ").trim() || ""
        label.replaceWith(text)
      }
      if (live) setSvg(DOMPurify.sanitize(new XMLSerializer().serializeToString(parsed.documentElement), { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["foreignObject"] }))
    }).catch(() => { if (live) setSvg(null) })
    return () => { live = false }
  }, [source, id])
  return svg ? <div role="img" aria-label="System diagram" className="overflow-x-auto rounded-md border bg-background p-4 [&_svg]:mx-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    : <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs"><code>{source}</code></pre>
}

export function Prose({ text }: { text: string }) {
  const chunks = text.split(/(```mermaid\s*\n[\s\S]*?\n```)/gi)
  return <div className="space-y-3 break-words text-sm leading-6 text-foreground/85">
    {chunks.map((chunk, index) => /^```mermaid\s*\n/i.test(chunk)
      ? <MermaidDiagram key={index} source={chunk.replace(/^```mermaid\s*\n/i, "").replace(/\n```$/, "")} />
      : <ReactMarkdown key={index} remarkPlugins={[remarkGfm]} components={{
        p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
        h1: ({ children }) => <h2 className="mt-5 text-base font-semibold text-foreground">{children}</h2>,
        h2: ({ children }) => <h3 className="mt-4 font-semibold text-foreground">{children}</h3>,
        h3: ({ children }) => <h4 className="mt-3 font-medium text-foreground">{children}</h4>,
        ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
        blockquote: ({ children }) => <blockquote className="border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
        a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{children}</a>,
        pre: ({ children }) => <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">{children}</pre>,
        code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>,
      }}>{chunk}</ReactMarkdown>)}
  </div>
}
