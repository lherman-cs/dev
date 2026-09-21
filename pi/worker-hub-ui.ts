import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";

const textOf = (content: any): string => typeof content === "string" ? content : Array.isArray(content)
  ? content.map(part => part.type === "text" ? part.text : part.type === "thinking" ? `thinking: ${part.thinking || part.text || ""}` : part.type === "toolCall" ? `→ ${part.name} ${JSON.stringify(part.arguments || {})}` : "").filter(Boolean).join("\n")
  : "";

export function workerLines(record: any): string[] {
  const lines: string[] = [];
  for (const message of record.messages || []) {
    if (message.role === "assistant") lines.push(...textOf(message.content).split("\n").map((line: string) => `assistant ${line}`));
    else if (message.role === "user") lines.push(...textOf(message.content).split("\n").map((line: string) => `user      ${line}`));
    else if (message.role === "toolResult") {
      const body = textOf(message.content).slice(0, 1200);
      lines.push(`← ${message.toolName || "tool"} ${body}${textOf(message.content).length > 1200 ? " [truncated]" : ""}`);
    }
  }
  return lines;
}

export function compactWorkerLines(records: any[], title = "dev workflow"): string[] {
  return [title, ...records.slice(0, 8).map(record => {
    const active = record.state === "working" || record.state === "aborting";
    const model = String(record.model || "").replace(/^gpt-[\d.]+-/, "");
    const stats = record.stats?.totalTokens ? ` ${record.stats.totalTokens} tok` : "";
    return `${active ? "●" : "○"} ${record.label.padEnd(16)} ${(model + " " + record.thinking).padEnd(14)} ${record.state.padEnd(10)} ${record.activity}${stats}`;
  })];
}

export class WorkerViewer {
  private unsubscribe: () => void;
  constructor(private tui: any, private hub: any, private id: string, private done: (action: string) => void) {
    this.unsubscribe = hub.subscribe(() => tui.requestRender());
  }
  render(width: number): string[] {
    const record = this.hub.get(this.id);
    if (!record) return ["Worker is no longer available.", "Esc: back"];
    const stats = record.stats || {};
    const header = `${record.label} · ${record.role} · ${record.model} ${record.thinking} · ${record.state}`;
    const usage = `tokens: ${stats.totalTokens || 0} (in ${stats.input || 0}, out ${stats.output || 0}, cache ${stats.cacheRead || 0})`;
    const transcript = workerLines(record).slice(-35);
    return [header, usage, `activity: ${record.activity}`, "", ...transcript, "", record.session ? "s: steer  f: follow-up  x: abort  Esc: back" : "Esc: back"].map(line => truncateToWidth(line, width));
  }
  handleInput(data: string) {
    if (matchesKey(data, "escape")) this.done("back");
    else if (data === "s") this.done("steer");
    else if (data === "f") this.done("follow-up");
    else if (data === "x") this.done("abort");
  }
  invalidate() {}
  dispose() { this.unsubscribe(); }
}

export function registerWorkerHubUI(pi: any, hub: any) {
  let ctx: any;
  let workflow = "dev workflow";
  const seen = new Map<string, string>();
  const renderWidget = () => {
    const records = hub.list();
    ctx?.ui.setWidget("dev-workers", records.length ? compactWorkerLines(records, workflow) : undefined);
    for (const record of records) {
      if (seen.get(record.id) === record.state) continue;
      seen.set(record.id, record.state);
      if (record.state === "working" || record.endedAt) pi.appendEntry("dev-worker-event", { label: record.label, state: record.state, timestamp: Date.now() });
    }
  };
  const unsubscribe = hub.subscribe(renderWidget);

  pi.registerEntryRenderer("dev-worker-event", (entry: any, _options: any, theme: any) =>
    new Text(theme.fg("dim", `[worker] ${entry.data.label}: ${entry.data.state}`), 0, 0));

  pi.registerCommand("dev-workers", {
    description: "Inspect and control workflow workers",
    handler: async (_args: string, commandCtx: any) => {
      ctx = commandCtx; renderWidget();
      while (true) {
        const records = hub.list();
        if (!records.length) { commandCtx.ui.notify("No workflow workers yet.", "info"); return; }
        const labels = records.map((record: any) => `${record.state === "working" ? "●" : "○"} ${record.label} · ${record.model} ${record.thinking} · ${record.state}`);
        const choice = await commandCtx.ui.select("Workflow workers", [...labels, "Close"]);
        if (!choice || choice === "Close") return;
        const record = records[labels.indexOf(choice)];
        let viewing = true;
        while (viewing && hub.get(record.id)) {
          const action = await commandCtx.ui.custom((tui: any, _theme: any, _keys: any, done: any) => new WorkerViewer(tui, hub, record.id, done),
            { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "85%", margin: 1 } });
          if (action === "back" || !action) { viewing = false; continue; }
          if (action === "abort") {
            if (await commandCtx.ui.confirm("Abort worker?", `Abort ${record.label}? Workflow state will be preserved.`)) await hub.abort(record.id);
          } else {
            const message = await commandCtx.ui.editor(action === "steer" ? "Steer current contract" : "Queue follow-up", "");
            if (message?.trim()) await (action === "steer" ? hub.steer(record.id, message.trim()) : hub.followUp(record.id, message.trim()));
          }
        }
      }
    },
  });

  return {
    setContext(nextCtx: any, title: string) { ctx = nextCtx; workflow = title; renderWidget(); },
    dispose() { unsubscribe(); ctx?.ui.setWidget("dev-workers", undefined); ctx = undefined; },
  };
}
