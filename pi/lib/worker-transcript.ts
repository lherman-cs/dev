import { stripVTControlCharacters } from "node:util";
import { Text, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
  AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent,
  createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createBashToolDefinition,
  createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";

export const safeText = (value: unknown): string => stripVTControlCharacters(String(value ?? ""))
  .replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "");
export const plainContent = (content: any): string => typeof content === "string" ? content : (content || []).map((p: any) =>
  p.type === "text" ? p.text : p.type === "thinking" ? `[Thinking]\n${p.thinking || ""}` : p.type === "toolCall"
    ? `${p.name}\n${JSON.stringify(p.arguments, null, 2)}` : `[${p.type || "Attachment"}: ${p.mimeType || p.mediaType || "inspect attachment"}]`).join("\n");
const safeValue = (value: any): any => typeof value === "string" ? safeText(value) : Array.isArray(value) ? value.map(safeValue)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "data" ? v : safeValue(v)])) : value;
export function rawTranscript(record: any): string {
  return [...record.messages, ...(record.streaming ? [record.streaming] : [])].map((m: any) =>
    `${m.role}${m.toolName ? ` · ${m.toolName}` : ""}\n${plainContent(m.content)}${m.details ? `\n${JSON.stringify(m.details, null, 2)}` : ""}`).join("\n\n");
}

/** Native Pi message/tool components; only viewport navigation belongs here. */
export class WorkerTranscript {
  private cache = new Map<string, any>();
  private layout: { key: string; lines: string[]; start: number }[] = [];
  private total = 0;
  private top = 0;
  private height = 1;
  private factories: any;
  private resultSource: any;
  private resultCount = -1;
  private results = new Map<string, any>();
  constructor(private tui: any, cwd: string) {
    this.factories = new Map(Object.entries({ read: createReadToolDefinition, write: createWriteToolDefinition,
      edit: createEditToolDefinition, bash: createBashToolDefinition, grep: createGrepToolDefinition,
      find: createFindToolDefinition, ls: createLsToolDefinition }).map(([name, make]: any) => [name, make(cwd)]));
    this.cwd = cwd;
  }
  private cwd: string;

  private block(key: string, source: any, stamp: any, width: number, make: () => any) {
    let cached = this.cache.get(key);
    if (!cached || cached.source !== source || cached.stamp !== stamp || cached.width !== width) {
      cached?.component.dispose?.();
      let component;
      try { component = make(); }
      catch (error: any) { component = new Text(`Renderer unavailable: ${safeText(error.message)}\n${safeText(JSON.stringify(source, null, 2))}`, 0, 0); }
      let lines;
      try { lines = component.render(width); }
      catch (error: any) { lines = new Text(`Renderer failed: ${safeText(error.message)}\n${safeText(JSON.stringify(source, null, 2))}`, 0, 0).render(width); }
      cached = { source, stamp, width, component, lines };
      this.cache.set(key, cached);
    }
    return { key, lines: cached.lines, start: 0 };
  }

  render(record: any, width: number, height: number, state: any): string[] {
    width = Math.max(1, width); this.height = Math.max(1, height);
    if (this.resultSource !== record.messages || this.resultCount !== record.messages.length) {
      this.results = new Map(record.messages.filter((m: any) => m.role === "toolResult").map((m: any) => [m.toolCallId, m]));
      this.resultSource = record.messages; this.resultCount = record.messages.length;
    }
    const blocks: any[] = [];
    const shownTools = new Set<string>();
    const messages = [...record.messages, ...(record.streaming ? [record.streaming] : [])];
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const key = index === record.messages.length ? "stream" : `m:${index}`;
      const stamp = `${state.raw}:${state.expanded}:${state.thinking}:${key === "stream" ? record.revision : "done"}`;
      if (state.raw) {
        blocks.push(this.block(key, message, stamp, width, () => new Text(safeText(`${message.role}\n${plainContent(message.content)}${message.details ? `\n${JSON.stringify(message.details, null, 2)}` : ""}\n`), 0, 0)));
        continue;
      }
      if (message.role === "assistant") {
        blocks.push(this.block(key, message, stamp, width, () => {
          const component = new AssistantMessageComponent(safeValue(message), !state.thinking);
          component.updateContent(safeValue(message), key === "stream"); return component;
        }));
      } else if (message.role === "user") {
        blocks.push(this.block(key, message, stamp, width, () => new UserMessageComponent(safeText(plainContent(message.content)))));
      } else if (message.role !== "toolResult") {
        blocks.push(this.block(key, message, stamp, width, () => new Text(safeText(plainContent(message.content)), 0, 0)));
      }
      const calls = (Array.isArray(message.content) ? message.content : []).filter((p: any) => p.type === "toolCall");
      if (message.role === "toolResult" && !shownTools.has(message.toolCallId)) calls.push({ id: message.toolCallId, name: message.toolName, arguments: {} });
      for (const call of calls) {
        if (shownTools.has(call.id)) continue;
        shownTools.add(call.id);
        const live = record.liveTools.get(call.id);
        const result = this.results.get(call.id) || live?.result;
        const args = live?.args || call.arguments || {};
        const toolStamp = `${stamp}:${live?.revision || 0}:${!!this.results.get(call.id)}:${width}`;
        blocks.push(this.block(`tool:${call.id}`, result || call, toolStamp, width, () => {
          const component = new ToolExecutionComponent(call.name || "tool", call.id || key, safeValue(args),
            { showImages: true, imageWidthCells: Math.max(1, Math.min(width - 4, 60)) }, this.factories.get(call.name), this.tui, this.cwd);
          component.setArgsComplete();
          component.setExpanded(!!state.expanded);
          if (result) component.updateResult({ ...safeValue(result), isError: !!(result.isError || live?.isError) }, !this.results.has(call.id) && live?.state === "running");
          return component;
        }));
      }
    }
    // Some tools can emit output before their assistant message is committed.
    for (const [id, tool] of record.liveTools) {
      if (!shownTools.has(id) && !state.raw) blocks.push(this.block(`live:${id}`, tool.result || tool, tool.revision, width,
        () => new Text(safeText(`${tool.toolName}\n${JSON.stringify(tool.args, null, 2)}\n${plainContent(tool.result?.content || [])}`), 0, 0)));
    }
    this.total = 0;
    for (const block of blocks) { block.start = this.total; this.total += block.lines.length; }
    this.layout = blocks;
    const maximum = Math.max(0, this.total - this.height);
    const anchored = state.anchor ? blocks.find(b => b.key === state.anchor.key) : undefined;
    this.top = state.follow !== false ? maximum : Math.min(maximum, Math.max(0, anchored ? anchored.start + Math.min(state.anchor.offset, Math.max(0, anchored.lines.length - 1)) : 0));
    const output: string[] = [];
    for (const block of blocks) {
      if (block.start + block.lines.length <= this.top) continue;
      const from = Math.max(0, this.top - block.start);
      output.push(...block.lines.slice(from, from + Math.max(0, this.height - output.length)));
      if (output.length >= this.height) break;
    }
    const liveKeys = new Set(blocks.map(b => b.key));
    for (const [key, cached] of this.cache) if (!liveKeys.has(key)) { cached.component.dispose?.(); this.cache.delete(key); }
    return output;
  }
  scroll(delta: number, state: any) {
    const target = Math.max(0, Math.min(Math.max(0, this.total - this.height), this.top + delta));
    state.follow = target >= Math.max(0, this.total - this.height);
    const block = [...this.layout].reverse().find(b => b.start <= target);
    state.anchor = block ? { key: block.key, offset: target - block.start } : null;
  }
  find(query: string, state: any): boolean {
    const needle = query.toLocaleLowerCase();
    for (const block of this.layout) {
      const offset = block.lines.findIndex(line => safeText(line).toLocaleLowerCase().includes(needle));
      if (offset >= 0) { state.follow = false; state.anchor = { key: block.key, offset }; return true; }
    }
    return false;
  }
  invalidate() { for (const value of this.cache.values()) value.component.dispose?.(); this.cache.clear(); }
  dispose() { this.invalidate(); }
}
