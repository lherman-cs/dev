import {
  AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent,
  createBashToolDefinition, createReadToolDefinition, createEditToolDefinition,
  createWriteToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text, Image, stripTerminalSequences } from "@earendil-works/pi-tui";

// Sanitize only the display projection. Native JSONL and explicit raw export
// retain original evidence; untrusted OSC/CSI/Bidi cannot control the terminal.
export const safeText = (text: string): string => stripTerminalSequences(String(text))
  .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "");
const displayValue = (value: any): any => {
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) return value.map(displayValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === "data" && value.type === "image" ? item : displayValue(item)]));
  return value;
};

export const contentText = (content: any): string => typeof content === "string" ? content : (content || []).map((p: any) =>
  p.type === "text" ? p.text : p.type === "thinking" ? p.thinking || "" : p.type === "toolCall" ? `${p.name}\n${JSON.stringify(p.arguments, null, 2)}` : p.type === "image" ? `[image: ${p.mimeType}]` : `[${p.type}]`).join("\n");

export type Viewport = { follow: boolean; anchor?: { key: string; row: number }; top?: number; height?: number; expanded?: boolean };
type Block = { key: string; component: any; raw: string; dirty: boolean; lines: string[]; width: number; result?: any; event?: any };

/** Native Pi renderers over full history + streaming state, with cached blocks. */
export class NativeTranscript {
  private blocks: Block[] = [];
  private byKey = new Map<string, Block>();
  private count = 0;
  private version = -1;
  private expanded = false;
  private hideThinking = true;
  private starts: number[] = [];
  private total = 0;
  private width = 80;
  private fallback: Record<string, any>;
  private disposed = false;
  constructor(private tui: any, private record: any) {
    const cwd = record.metadata?.cwd || process.cwd();
    this.fallback = Object.fromEntries([
      ["bash", createBashToolDefinition], ["read", createReadToolDefinition], ["edit", createEditToolDefinition],
      ["write", createWriteToolDefinition], ["grep", createGrepToolDefinition], ["find", createFindToolDefinition], ["ls", createLsToolDefinition],
    ].map(([name, factory]: any) => [name, factory(cwd)]));
  }
  private add(key: string, factory: () => any, raw = "") {
    let block = this.byKey.get(key);
    if (!block) {
      block = { key, component: factory(), raw, dirty: true, lines: [], width: 0 };
      this.byKey.set(key, block); this.blocks.push(block);
    }
    return block;
  }
  private tool(id: string, name: string, args: any) {
    return this.add(`tool:${id}`, () => {
      const definition = this.record.session?.getToolDefinition?.(name) || this.fallback[name];
      const ui = { ...this.tui, requestRender: () => { if (!this.disposed) { this.invalidate(); this.tui.requestRender(); } } };
      const component = new ToolExecutionComponent(safeText(name), id, displayValue(args || {}), { showImages: true }, definition, ui, this.record.metadata?.cwd || process.cwd());
      component.setExpanded(this.expanded);
      return component;
    }, `${name}\n${JSON.stringify(args || {}, null, 2)}`);
  }
  private message(message: any, index: number, streaming = false) {
    if (message.role === "assistant") {
      const block = this.add(`message:${index}`, () => new AssistantMessageComponent(undefined, this.hideThinking), contentText(message.content));
      block.component.updateContent(displayValue(message), streaming); block.raw = contentText(message.content); block.dirty = true;
      for (const p of message.content || []) if (p.type === "toolCall") {
        const tool = this.tool(p.id, p.name, p.arguments);
        tool.component.updateArgs(displayValue(p.arguments)); tool.raw = `${p.name}\n${JSON.stringify(p.arguments || {}, null, 2)}`; tool.dirty = true;
        if (!streaming) tool.component.setArgsComplete();
      }
    } else if (message.role === "toolResult") {
      const block = this.tool(message.toolCallId, message.toolName || "tool", {});
      block.component.updateResult(displayValue({ ...message, isError: !!message.isError }), false);
      block.raw += `\n${contentText(message.content)}`; block.dirty = true; block.result = message;
    } else if (message.role === "user") {
      this.add(`message:${index}`, () => new UserMessageComponent(safeText(contentText(message.content))), contentText(message.content));
    } else if (message.role !== "system") {
      const raw = `${message.role}\n${contentText(message.content) || message.output || ""}`;
      this.add(`message:${index}`, () => new Text(safeText(raw), 1, 0), raw);
    }
    // Native tool renderers show graphics when supported but some omit a
    // fallback on text-only terminals. Keep an explicit attachment marker.
    if (!streaming && Array.isArray(message.content)) message.content.forEach((p: any, n: number) => {
      if (p.type !== "image") return;
      this.add(`image-label:${index}:${n}`, () => new Text(`Image · ${safeText(p.mimeType)} (retained in the saved Pi transcript)`, 1, 0), `[image: ${p.mimeType}]`);
      if (message.role === "user" && p.data) this.add(`image:${index}:${n}`, () => new Image(p.data, p.mimeType, { fallbackColor: s => s }, { maxHeightCells: 18 }));
    });
  }
  sync(record = this.record) {
    this.record = record;
    if (this.version === record.version) return;
    const messages = record.messages || [];
    for (; this.count < messages.length; this.count++) this.message(messages[this.count], this.count);
    if (record.partial) this.message(record.partial, messages.length, true);
    for (const [id, event] of record.tools || []) {
      const block = this.tool(id, event.toolName, event.args);
      if (block.event === event) continue;
      block.event = event; block.dirty = true;
      if (event.type === "tool_execution_start") block.component.markExecutionStarted();
      if (event.type === "tool_execution_update" && event.partialResult) {
        block.component.updateResult(displayValue({ ...event.partialResult, isError: false }), true);
        block.raw = `${event.toolName}\n${JSON.stringify(event.args || {})}\n${contentText(event.partialResult.content)}`;
      }
      if (event.type === "tool_execution_end") block.component.updateResult(displayValue({ ...event.result, isError: !!event.isError }), false);
    }
    this.version = record.version;
  }
  setExpanded(expanded: boolean) {
    this.expanded = expanded;
    for (const b of this.blocks) if (b.key.startsWith("tool:")) { b.component.setExpanded(expanded); b.dirty = true; }
  }
  toggleThinking() {
    this.hideThinking = !this.hideThinking;
    for (const b of this.blocks) { b.component.setHideThinkingBlock?.(this.hideThinking); b.dirty = true; }
  }
  private layout(width: number) {
    this.sync(); this.width = width; this.starts = []; this.total = 0;
    for (const b of this.blocks) {
      if (b.dirty || b.width !== width) {
        try { b.lines = b.component.render(width); }
        catch (error: any) { b.lines = new Text(safeText(`Renderer error: ${error.message}\n${b.raw}`), 0, 0).render(width); }
        b.dirty = false; b.width = width;
      }
      this.starts.push(this.total); this.total += b.lines.length;
    }
  }
  private anchor(top: number) {
    let i = this.starts.findIndex((start, n) => start + this.blocks[n].lines.length > top);
    if (i < 0) i = Math.max(0, this.blocks.length - 1);
    return { key: this.blocks[i]?.key || "", row: Math.max(0, top - (this.starts[i] || 0)) };
  }
  window(state: Viewport, width: number, height: number) {
    this.layout(Math.max(1, width));
    const max = Math.max(0, this.total - height);
    const index = state.anchor ? this.blocks.findIndex(b => b.key === state.anchor!.key) : -1;
    const top = state.follow ? max : Math.min(max, Math.max(0, index >= 0 ? this.starts[index] + Math.min(state.anchor!.row, Math.max(0, this.blocks[index].lines.length - 1)) : state.top || 0));
    state.top = top; state.height = height;
    const lines: string[] = [];
    for (let i = 0; i < this.blocks.length && lines.length < height; i++) {
      if (this.starts[i] + this.blocks[i].lines.length <= top) continue;
      lines.push(...this.blocks[i].lines.slice(Math.max(0, top - this.starts[i]), Math.max(0, top - this.starts[i]) + height - lines.length));
    }
    return { lines, total: this.total, start: top, end: top + lines.length };
  }
  scroll(state: Viewport, delta: number) {
    const max = Math.max(0, this.total - (state.height || 1));
    const top = Math.max(0, Math.min(max, (state.top || 0) + delta));
    state.follow = top === max; state.anchor = this.anchor(top); state.top = top;
  }
  live(state: Viewport) { state.follow = true; state.anchor = undefined; }
  search(state: Viewport, query: string) {
    const q = query.toLocaleLowerCase(); if (!q) return false;
    this.sync();
    const candidates = this.blocks.filter(b => b.raw.toLocaleLowerCase().includes(q));
    for (const b of candidates) if (b.key.startsWith("tool:")) { b.component.setExpanded(true); b.dirty = true; state.expanded = true; }
    this.layout(this.width);
    const hits = candidates.flatMap(b => {
      const index = this.blocks.indexOf(b);
      const rows = b.lines.flatMap((line, row) => stripTerminalSequences(line).toLocaleLowerCase().includes(q) ? [{ key: b.key, row, index }] : []);
      return rows.length ? rows : [{ key: b.key, row: 0, index }];
    });
    const index = this.blocks.findIndex(b => b.key === state.anchor?.key);
    const found = hits.find(h => h.index > index || (h.index === index && h.row > (state.anchor?.row ?? -1))) || hits[0];
    if (!found) return false;
    state.follow = false; state.anchor = { key: found.key, row: found.row }; return true;
  }
  exportText() {
    // Export original content, never rendered/truncated previews. Active output
    // is explicitly labelled, and settled tool results are not duplicated.
    const messages = this.record.messages || [];
    const parts = messages.map((m: any) => `${m.role}${m.toolName ? ` · ${m.toolName}` : ""}\n${contentText(m.content) || m.output || ""}`);
    if (this.record.partial) parts.push(`assistant · streaming\n${contentText(this.record.partial.content)}`);
    const settled = new Set(messages.filter((m: any) => m.role === "toolResult").map((m: any) => m.toolCallId));
    for (const [id, event] of this.record.tools || []) {
      if (settled.has(id)) continue;
      const result = event.result || event.partialResult;
      parts.push(`tool · ${event.toolName} · ${event.type === "tool_execution_end" ? "finished" : "running"}\n${JSON.stringify(event.args || {}, null, 2)}\n${contentText(result?.content)}`);
    }
    return parts.join("\n\n");
  }
  invalidate() { for (const b of this.blocks) { b.dirty = true; b.component.invalidate?.(); } }
  dispose() { this.disposed = true; for (const b of this.blocks) b.component.dispose?.(); }
}
