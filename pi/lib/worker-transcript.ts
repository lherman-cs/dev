import {
  AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent,
  createBashToolDefinition, createReadToolDefinition, createEditToolDefinition,
  createWriteToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text, Image, stripTerminalSequences, type Component, type TUI } from "@earendil-works/pi-tui";
import type { MessagePart, WorkerContent, WorkerMessage, WorkerRecord, WorkerToolState } from "./worker-types.ts";

// Sanitize only the display projection. Native JSONL and explicit raw export
// retain original evidence; untrusted OSC/CSI/Bidi cannot control the terminal.
export const safeText = (text: string): string => stripTerminalSequences(String(text))
  .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "");
type DisplayValue = string | number | boolean | null | undefined | DisplayValue[] | { [key: string]: DisplayValue | unknown };
const displayValue = (value: unknown): DisplayValue => {
  if (typeof value === "string") return safeText(value);
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(displayValue);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(source).map(([key, item]) =>
      [key, key === "data" && source["type"] === "image" ? item : displayValue(item)]));
  }
  return String(value);
};

const partText = (part: MessagePart): string => part.type === "text" ? String(part.text ?? "")
  : part.type === "thinking" ? String(part["thinking"] ?? "")
  : part.type === "toolCall" ? `${String(part["name"] ?? "tool")}\n${JSON.stringify(part["arguments"], null, 2)}`
  : `[image: ${String(part.mimeType ?? "unknown")}]`;
export const contentText = (content: WorkerContent | undefined): string => typeof content === "string" ? content : (content ?? []).map(partText).join("\n");
const messageContent = (message: WorkerMessage): WorkerContent | undefined => "content" in message ? message.content : undefined;
const messageOutput = (message: WorkerMessage): string => "output" in message && typeof message.output === "string" ? message.output : "";

export type Viewport = { follow: boolean; anchor?: { key: string; row: number }; top?: number; height?: number; expanded?: boolean; hideThinking?: boolean; searchQuery?: string; match?: number; matches?: number };
type DisposableComponent = Component & { invalidate?(): void; dispose?(): void };
type Block = { key: string; component: DisposableComponent; raw: string; dirty: boolean; lines: string[]; width: number; event?: WorkerToolState };
type FallbackTool = ReturnType<typeof createBashToolDefinition> | ReturnType<typeof createReadToolDefinition>
  | ReturnType<typeof createEditToolDefinition> | ReturnType<typeof createWriteToolDefinition>
  | ReturnType<typeof createGrepToolDefinition> | ReturnType<typeof createFindToolDefinition> | ReturnType<typeof createLsToolDefinition>;
const toolFactories = [
  ["bash", createBashToolDefinition], ["read", createReadToolDefinition], ["edit", createEditToolDefinition],
  ["write", createWriteToolDefinition], ["grep", createGrepToolDefinition], ["find", createFindToolDefinition], ["ls", createLsToolDefinition],
] as const;

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
  private fallback: Record<string, FallbackTool>;
  private disposed = false;
  private tui: TUI;
  private record: WorkerRecord;
  constructor(tui: TUI, record: WorkerRecord) {
    this.tui=tui;this.record=record;
    const cwd = typeof record.metadata["cwd"] === "string" ? record.metadata["cwd"] : process.cwd();
    this.fallback = Object.fromEntries(toolFactories.map(([name, factory]) => [name, factory(cwd)] as const));
  }
  private add(key: string, factory: () => DisposableComponent, raw = ""): Block {
    let block = this.byKey.get(key);
    if (!block) {
      block = { key, component: factory(), raw, dirty: true, lines: [], width: 0 };
      this.byKey.set(key, block); this.blocks.push(block);
    }
    return block;
  }
  private tool(id: string, name: string, args: Record<string, unknown>) {
    return this.add(`tool:${id}`, () => {
      const definition = this.record.session?.getToolDefinition?.(name) ?? this.fallback[name];
      const ui = { ...this.tui, requestRender: () => { if (!this.disposed) { this.invalidate(); this.tui.requestRender(); } } };
      const cwd = typeof this.record.metadata["cwd"] === "string" ? this.record.metadata["cwd"] : process.cwd();
      const component = new ToolExecutionComponent(safeText(name), id, displayValue(args) as Record<string, unknown>, { showImages: true }, definition, ui, cwd);
      component.setExpanded(this.expanded);
      return component;
    }, `${name}\n${JSON.stringify(args || {}, null, 2)}`);
  }
  private message(message: WorkerMessage, index: number, streaming = false) {
    if (message.role === "assistant") {
      const block = this.add(`message:${index}`, () => new AssistantMessageComponent(undefined, this.hideThinking), contentText(message.content));
      (block.component as AssistantMessageComponent).updateContent(displayValue(message) as never, streaming); block.raw = contentText(message.content); block.dirty = true;
      for (const p of typeof message.content === "string" ? [] : message.content) if (p.type === "toolCall") {
        const id = String(p["id"] ?? ""); const name = String(p["name"] ?? "tool");
        const args = p["arguments"] && typeof p["arguments"] === "object" ? p["arguments"] as Record<string, unknown> : {};
        const tool = this.tool(id, name, args);
        const toolComponent = tool.component as ToolExecutionComponent;
        toolComponent.updateArgs(displayValue(args) as Record<string, unknown>); tool.raw = `${name}\n${JSON.stringify(args, null, 2)}`; tool.dirty = true;
        if (!streaming) toolComponent.setArgsComplete();
      }
    } else if (message.role === "toolResult") {
      const block = this.tool(message.toolCallId ?? "", typeof message["toolName"] === "string" ? message["toolName"] : "tool", {});
      (block.component as ToolExecutionComponent).updateResult(displayValue({ ...message, isError: Boolean(message["isError"]) }) as never, false);
      block.raw += `\n${contentText(message.content)}`; block.dirty = true;
    } else if (message.role === "user") {
      this.add(`message:${index}`, () => new UserMessageComponent(safeText(contentText(message.content))), contentText(message.content));
    } else if (message.role !== "system") {
      const raw = `${message.role}\n${contentText(messageContent(message)) || messageOutput(message)}`;
      this.add(`message:${index}`, () => new Text(safeText(raw), 1, 0), raw);
    }
    // Native tool renderers show graphics when supported but some omit a
    // fallback on text-only terminals. Keep an explicit attachment marker.
    const content = messageContent(message);
    if (!streaming && Array.isArray(content)) content.forEach((p, n) => {
      if (p.type !== "image") return;
      const mimeType = String(p["mimeType"] ?? "application/octet-stream"); const data = typeof p["data"] === "string" ? p["data"] : undefined;
      this.add(`image-label:${index}:${n}`, () => new Text(`Image · ${safeText(mimeType)} (retained in the saved Pi transcript)`, 1, 0), `[image: ${mimeType}]`);
      if (message.role === "user" && data) this.add(`image:${index}:${n}`, () => new Image(data, mimeType, { fallbackColor: s => s }, { maxHeightCells: 18 }));
    });
  }
  sync(record: WorkerRecord = this.record): void {
    this.record = record;
    if (this.version === record.version) return;
    const messages = record.messages || [];
    for (; this.count < messages.length; this.count++) { const message = messages[this.count]; if (message) this.message(message, this.count); }
    if (record.partial) this.message(record.partial, messages.length, true);
    for (const [id, event] of record.tools || []) {
      const toolName = typeof event["toolName"] === "string" ? event["toolName"] : "tool";
      const eventArgs = "args" in event ? event.args : undefined;
      const args = eventArgs && typeof eventArgs === "object" ? eventArgs as Record<string, unknown> : {};
      const block = this.tool(id, toolName, args);
      if (block.event === event) continue;
      block.event = event; block.dirty = true;
      const toolComponent = block.component as ToolExecutionComponent;
      if (event["type"] === "tool_execution_start") toolComponent.markExecutionStarted();
      const partial = event.type === "tool_execution_update" ? event.partialResult : undefined;
      if (event.type === "tool_execution_update" && partial && typeof partial === "object") {
        toolComponent.updateResult(displayValue({ ...partial as Record<string, unknown>, isError: false }) as never, true);
        const content = (partial as { content?: WorkerContent }).content;
        block.raw = `${toolName}\n${JSON.stringify(args)}\n${contentText(content)}`;
      }
      if (event.type === "tool_execution_end") toolComponent.updateResult(displayValue({ ...(event.result as Record<string, unknown> ?? {}), isError: event.isError }) as never, false);
    }
    this.version = record.version;
  }
  setExpanded(expanded: boolean) {
    this.expanded = expanded;
    for (const b of this.blocks) if (b.key.startsWith("tool:")) { (b.component as ToolExecutionComponent).setExpanded(expanded); b.dirty = true; }
  }
  setHideThinking(value: boolean) {
    this.hideThinking = value;
    for (const b of this.blocks) { if (b.component instanceof AssistantMessageComponent) b.component.setHideThinkingBlock(this.hideThinking); b.dirty = true; }
  }
  toggleThinking() { this.setHideThinking(!this.hideThinking); }
  private layout(width: number) {
    this.sync(); this.width = width; this.starts = []; this.total = 0;
    for (const b of this.blocks) {
      if (b.dirty || b.width !== width) {
        try { b.lines = b.component.render(width); }
        catch (error: unknown) { b.lines = new Text(safeText(`Renderer error: ${error instanceof Error ? error.message : String(error)}\n${b.raw}`), 0, 0).render(width); }
        b.dirty = false; b.width = width;
      }
      this.starts.push(this.total); this.total += b.lines.length;
    }
  }
  private anchor(top: number) {
    let i = this.starts.findIndex((start, n) => start + (this.blocks[n]?.lines.length ?? 0) > top);
    if (i < 0) i = Math.max(0, this.blocks.length - 1);
    return { key: this.blocks[i]?.key || "", row: Math.max(0, top - (this.starts[i] || 0)) };
  }
  window(state: Viewport, width: number, height: number) {
    this.layout(Math.max(1, width));
    const max = Math.max(0, this.total - height);
    const index = state.anchor ? this.blocks.findIndex(b => b.key === state.anchor!.key) : -1;
    const anchoredBlock = index >= 0 ? this.blocks[index] : undefined; const anchoredStart = index >= 0 ? this.starts[index] : undefined;
    const top = state.follow ? max : Math.min(max, Math.max(0, anchoredBlock && anchoredStart !== undefined ? anchoredStart + Math.min(state.anchor!.row, Math.max(0, anchoredBlock.lines.length - 1)) : state.top || 0));
    state.top = top; state.height = height;
    const lines: string[] = [];
    for (let i = 0; i < this.blocks.length && lines.length < height; i++) {
      const block = this.blocks[i]; const start = this.starts[i]; if (!block || start === undefined) continue;
      if (start + block.lines.length <= top) continue;
      lines.push(...block.lines.slice(Math.max(0, top - start), Math.max(0, top - start) + height - lines.length));
    }
    return { lines, total: this.total, start: top, end: top + lines.length };
  }
  scroll(state: Viewport, delta: number) {
    const max = Math.max(0, this.total - (state.height || 1));
    const top = Math.max(0, Math.min(max, (state.top || 0) + delta));
    state.follow = top === max; state.anchor = this.anchor(top); state.top = top;
  }
  live(state: Viewport) { state.follow = true; delete state.anchor; }
  search(state: Viewport, query: string, direction: 1 | -1 = 1) {
    const q = query.toLocaleLowerCase(); if (!q) { state.searchQuery = ""; state.matches = 0; delete state.match; return false; }
    state.searchQuery = query;
    this.sync();
    const candidates = this.blocks.filter(b => b.raw.toLocaleLowerCase().includes(q));
    for (const b of candidates) if (b.key.startsWith("tool:")) { (b.component as ToolExecutionComponent).setExpanded(true); b.dirty = true; state.expanded = true; }
    this.layout(this.width);
    const hits = candidates.flatMap(b => {
      const index = this.blocks.indexOf(b);
      const rows = b.lines.flatMap((line, row) => stripTerminalSequences(line).toLocaleLowerCase().includes(q) ? [{ key: b.key, row, index }] : []);
      return rows.length ? rows : [{ key: b.key, row: 0, index }];
    });
    state.matches = hits.length;
    if (!hits.length) { delete state.match; return false; }
    const index = this.blocks.findIndex(b => b.key === state.anchor?.key);
    const current = hits.findIndex(h => h.index === index && h.row === state.anchor?.row);
    const target = current >= 0 ? (current + direction + hits.length) % hits.length
      : direction === 1 ? Math.max(0, hits.findIndex(h => h.index > index || h.index === index && h.row > (state.anchor?.row ?? -1)))
        : (hits.map((h, i) => h.index < index || h.index === index && h.row < (state.anchor?.row ?? 0) ? i : -1).reduce((a, b) => Math.max(a, b), -1) + hits.length) % hits.length;
    const found = hits[target]!;
    state.match = target + 1; state.follow = false; state.anchor = { key: found.key, row: found.row }; return true;
  }
  exportText() {
    // Export original content, never rendered/truncated previews. Active output
    // is explicitly labelled, and settled tool results are not duplicated.
    const messages = this.record.messages || [];
    const parts = messages.map(message => `${message.role}${message.role === "toolResult" ? ` · ${message.toolName}` : ""}\n${contentText(messageContent(message)) || messageOutput(message)}`);
    if (this.record.partial) parts.push(`assistant · streaming\n${contentText(messageContent(this.record.partial))}`);
    const settled = new Set(messages.filter(m => m.role === "toolResult").map(m => m.toolCallId));
    for (const [id, event] of this.record.tools || []) {
      if (settled.has(id)) continue;
      const result = event.type === "tool_execution_end" ? event.result : event.type === "tool_execution_update" ? event.partialResult : undefined;
      const resultContent = result && typeof result === "object" ? (result as { content?: WorkerContent }).content : undefined;
      const args = "args" in event ? event.args : {};
      parts.push(`tool · ${event.toolName} · ${event.type === "tool_execution_end" ? "finished" : "running"}\n${JSON.stringify(args, null, 2)}\n${contentText(resultContent)}`);
    }
    return parts.join("\n\n");
  }
  forEachComponent(visitor: (component: Component) => void): void { for (const block of this.blocks) visitor(block.component); }
  invalidate() { for (const b of this.blocks) { b.dirty = true; b.component.invalidate?.(); } }
  dispose() { this.disposed = true; for (const b of this.blocks) b.component.dispose?.(); }
}
