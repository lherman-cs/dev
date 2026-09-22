import { randomUUID } from "node:crypto";
import type { HubQuestion, PersistedWorker, RegisterWorker, WorkerDelivery, WorkerEvent, WorkerHistoryStore, WorkerMessage, WorkerPatch, WorkerRecord, WorkerState, WorkerStats } from "./worker-types.ts";

const tokens = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const;
const textOf = (message: WorkerMessage): string => {
  if (!("content" in message)) return "";
  return typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
};
export const isActive = (record: WorkerRecord | undefined): record is WorkerRecord & { session: NonNullable<WorkerRecord["session"]> } => !!record?.session && !record.closed;
const emptyStats = (): WorkerStats => ({ input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null, cost: null, requests: 0, tools: 0 });
function addUsage(stats: WorkerStats, message: WorkerMessage): void {
  if (message.role !== "assistant") return;
  stats.requests++;
  stats.tools += Array.isArray(message.content) ? message.content.filter(p => p.type === "toolCall").length : 0;
  if (!message.usage) return;
  for (const key of tokens) {
    const value = message.usage[key];
    if (typeof value === "number" && Number.isFinite(value)) stats[key] = (stats[key] ?? 0) + value;
  }
  const cost = message.usage.cost?.total;
  if (typeof cost === "number" && Number.isFinite(cost)) stats.cost = (stats.cost ?? 0) + cost;
}

/** Presentation + owner-supplied actions, never workflow policy or spawning. */
export class WorkerHub {
  #records = new Map<string, WorkerRecord>();
  #listeners = new Set<(records: WorkerRecord[], changed?: WorkerRecord) => void>();
  #disposed = false;
  #history: WorkerHistoryStore | undefined;
  #draftTimers = new Map<string, NodeJS.Timeout>();
  #pins = new Map<string, number>();
  #questions = new Map<string, HubQuestion>();
  onError: (error: Error) => void;
  onRelated: ((record: WorkerRecord, text: string) => string | Promise<string>) | undefined;

  constructor({ history, onError = () => undefined, onRelated }: { history?: WorkerHistoryStore; onError?: (error: Error) => void; onRelated?: (record: WorkerRecord, text: string) => string | Promise<string> } = {}) {
    this.#history = history; this.onError = onError; this.onRelated = onRelated;
  }
  setHistory(history: WorkerHistoryStore): void { this.#history = history; }
  nextId(role: string): string { return `${role}:${randomUUID()}`; }
  subscribe(listener: (records: WorkerRecord[], changed?: WorkerRecord) => void): () => boolean { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #warn(error: unknown): void { try { this.onError(error instanceof Error ? error : new Error(String(error))); } catch { /* reporting must not break execution */ } }
  #emit(record?: WorkerRecord): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) {
      try { listener(this.list(), record); } catch (error) { this.#warn(error); }
    }
  }
  #persist(record: WorkerRecord): void { try { this.#history?.saveMetadata(record); } catch (error) { record.storageError = error instanceof Error ? error.message : String(error); this.#warn(error); } }

  register({ id, label, role, model, thinking, session, metadata = {}, actions }: RegisterWorker): string {
    if (this.#disposed) throw new Error("Agent Hub is closed.");
    if (this.#records.has(id)) throw new Error(`Worker ${id} is already registered.`);
    const messages = [...(session.messages || [])];
    const record: WorkerRecord = {
      id, label: label || id, role, model, thinking, session, metadata, actions,
      state: "working", activity: "Starting", startedAt: Date.now(), updatedAt: Date.now(), endedAt: null,
      messages, stats: emptyStats(), context: undefined, partial: undefined, tools: new Map(),
      deliveries: [], draft: "", version: 0, unread: true, closed: false, seen: new WeakSet(messages),
      file: session.sessionFile ?? session.sessionManager?.getSessionFile?.(), unsubscribe: undefined,
    };
    for (const message of messages) addUsage(record.stats, message);
    record.unsubscribe = session.subscribe(event => {
      try { this.#event(record, event); } catch (error) { this.#warn(error); }
    });
    this.#records.set(id, record); this.#persist(record); this.#emit(record);
    return id;
  }

  #event(record: WorkerRecord, event: WorkerEvent): void {
    if (record.closed || this.#disposed) return;
    record.updatedAt = Date.now();
    const { type } = event;
    if (type === "message_start" && event.message.role === "user") {
      const text = textOf(event.message);
      const delivery = record.deliveries.find(d => ["sending", "queued"].includes(d.status) && d.text === text);
      if (delivery) { delivery.status = "delivered"; delivery.deliveredAt = Date.now(); this.#persist(record); }
    }
    if (type === "message_update") {
      record.partial = event.message;
      record.activity = event.assistantMessageEvent?.type?.startsWith("thinking") ? "Thinking" : "Responding";
      record.version++;
    } else if (type === "message_end") {
      const fresh = !record.seen.has(event.message);
      record.seen.add(event.message);
      if (fresh) record.messages?.push(event.message);
      if (event.message.role === "assistant") record.partial = undefined;
      if (event.message.role === "toolResult" && event.message.toolCallId) record.tools.delete(event.message.toolCallId);
      if (fresh) addUsage(record.stats, event.message);
      record.version++; record.unread = true;
      record.context = record.session?.getContextUsage?.();
    } else if (type === "tool_execution_start" || type === "tool_execution_update") {
      record.tools.set(event.toolCallId, { ...record.tools.get(event.toolCallId), ...event });
      const detail = event.args?.["path"] || event.args?.["command"] || event.args?.["query"] || "";
      record.activity = `${event.toolName}${detail ? ` ${String(detail).replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
      record.version++;
    } else if (type === "tool_execution_end") {
      record.tools.set(event.toolCallId, { ...record.tools.get(event.toolCallId), ...event });
      record.activity = event.isError ? `${event.toolName} failed` : `${event.toolName} finished`;
      record.version++; record.unread = true;
    } else if (type === "agent_start") record.activity = "Waiting for model";
    else if (type === "compaction_start") record.activity = "Compacting context";
    else if (type === "compaction_end") {
      record.context = record.session?.getContextUsage?.();
      record.activity = event.errorMessage ? `Compaction failed: ${event.errorMessage}` : "Context compacted";
    } else if (type === "auto_retry_start") record.activity = `Provider retry ${event.attempt}/${event.maxAttempts}`;
    else if (type === "agent_end") record.activity = event.willRetry ? "Retrying" : "Finishing";
    else if (type === "agent_settled") record.activity = "Settled";
    else if (type === "queue_update") record.queue = { steering: event.steering.length, followUp: event.followUp.length };
    this.#emit(record);
  }

  restore(data: PersistedWorker): void {
    if (this.#disposed || this.#records.has(data.id)) return;
    this.#records.set(data.id, { ...data, session: undefined, actions: undefined, stats: data.stats || emptyStats(), metadata: data.metadata || {}, tools: new Map(), deliveries: data.deliveries || [], draft: data.draft || "", version: 0, unread: false, closed: true, seen: new WeakSet(), unsubscribe: undefined });
    this.#emit(this.get(data.id));
  }
  update(id: string, patch: WorkerPatch): boolean {
    const record = this.get(id); if (!record) return false;
    if (patch.label !== undefined) record.label = patch.label;
    if (patch.metadata !== undefined) record.metadata = patch.metadata;
    if (patch.state !== undefined) record.state = patch.state;
    if (patch.activity !== undefined) record.activity = patch.activity;
    if (patch.accepting !== undefined) record.accepting = patch.accepting;
    if (patch.outcome !== undefined) record.outcome = patch.outcome;
    if (patch.context !== undefined) record.context = patch.context;
    record.updatedAt = Date.now();
    if (record.closed) this.#persist(record);
    this.#emit(record); return true;
  }
  seal(id: string): void { const record = this.get(id); if (record) { record.accepting = false; this.#emit(record); } }
  unregister(id: string | undefined, state: WorkerState = "completed"): boolean {
    const record = this.get(id); if (!record || record.closed) return false;
    record.unsubscribe?.(); record.unsubscribe = undefined;
    record.state = state; record.activity = state === "completed" ? "Worker finished" : state;
    record.endedAt = Date.now(); record.closed = true; record.accepting = false; record.unread = true;
    for (const d of record.deliveries) if (["queued", "sending"].includes(d.status)) {
      d.status = "failed"; d.error = "Agent stopped before delivery. Restore this message to send it elsewhere.";
    }
    this.flushDraft(record.id); this.#persist(record);
    record.session = undefined; record.actions = undefined; record.partial = undefined; record.tools.clear();
    this.#trim(); this.#emit(record); return true;
  }
  list(): WorkerRecord[] { return [...this.#records.values()]; } // Stable order: activity never moves a target under the cursor.
  get(id: string | undefined): WorkerRecord | undefined { return id === undefined ? undefined : this.#records.get(id); }
  pin(id: string): () => void {
    this.#pins.set(id, (this.#pins.get(id) || 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.#pins.get(id) || 0) - 1;
      if (count > 0) this.#pins.set(id, count); else this.#pins.delete(id);
      this.#trim();
    };
  }
  #trim(): void {
    const cached = this.list().filter(r => r.closed && r.messages && r.file && !this.#pins.get(r.id));
    for (const record of cached.slice(0, -12)) record.messages = undefined;
  }
  load(id: string): WorkerRecord {
    const record = this.get(id); if (!record) throw new Error("Thread is no longer available.");
    if (!record.messages) {
      try { record.messages = this.#history?.load(record) || []; record.version++; }
      catch (error) { record.storageError = error instanceof Error ? error.message : String(error); throw error; }
    }
    record.unread = false;
    return record;
  }
  setDraft(id: string, text: string): void {
    const record = this.get(id); if (!record) return;
    record.draft = text;
    clearTimeout(this.#draftTimers.get(id));
    this.#draftTimers.set(id, setTimeout(() => this.flushDraft(id), 250));
    this.#draftTimers.get(id)?.unref?.();
  }
  flushDraft(id: string): void {
    clearTimeout(this.#draftTimers.get(id)); this.#draftTimers.delete(id);
    const record = this.get(id); if (!record || record.savedDraft === record.draft) return;
    try { this.#history?.saveDraft(record, record.draft); record.savedDraft = record.draft; }
    catch (error) { record.storageError = error instanceof Error ? error.message : String(error); this.#warn(error); }
  }
  canSend(id: string): boolean {
    const r = this.get(id);
    return !!(isActive(r) && r.accepting !== false && r.state === "working" && (r.actions?.send || r.session?.steer));
  }
  async send(id: string, text: string, mode: "steer" | "followUp" = "steer"): Promise<WorkerDelivery> {
    if (!["steer", "followUp"].includes(mode)) throw new Error("Unknown delivery mode.");
    if (!text?.trim()) throw new Error("Message is empty.");
    const record = this.get(id);
    if (!isActive(record) || record.accepting === false || record.state !== "working" || !(record.actions?.send || record.session[mode])) throw new Error("Agent is no longer accepting messages. Your draft is preserved.");
    const delivery: WorkerDelivery = { id: randomUUID(), text, mode, status: "sending", at: Date.now() };
    record.deliveries.push(delivery); this.#persist(record); this.#emit(record);
    try {
      if (record.actions?.send) await record.actions.send(text, mode);
      else {
        const send = record.session[mode];
        if (!send) throw new Error(`Agent does not support ${mode} delivery.`);
        await send.call(record.session, text);
      }
      if (delivery.status === "failed" || (record.closed && delivery.status !== "delivered")) throw new Error(delivery.error || "Agent finished before delivery.");
      if (delivery.status === "sending") delivery.status = "queued";
      return delivery;
    } catch (error) {
      delivery.status = "failed"; delivery.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally { this.#persist(record); this.#emit(record); }
  }
  steer(id: string, text: string): Promise<WorkerDelivery> { return this.send(id, text, "steer"); }
  followUp(id: string, text: string): Promise<WorkerDelivery> { return this.send(id, text, "followUp"); }
  async abort(id: string): Promise<boolean> {
    const record = this.get(id);
    if (!isActive(record) || record.state === "aborting") return false;
    const previous = record.state;
    this.update(id, { state: "aborting", accepting: false, activity: "Stopping; completed effects are not undone" });
    try { await (record.actions?.stop ? record.actions.stop() : record.session.abort()); return true; }
    catch (error) { this.update(id, { state: previous, activity: `Stop failed: ${error instanceof Error ? error.message : String(error)}` }); throw error; }
  }
  async cancelQueued(id: string): Promise<number> {
    const record = this.get(id);
    if (!isActive(record) || !record.actions?.cancelQueued) throw new Error("This owner cannot cancel a queue.");
    const removed = await record.actions.cancelQueued();
    const pending = { steer: [...removed.steering], followUp: [...removed.followUp] };
    let count = 0;
    for (const d of record.deliveries) if (["sending", "queued"].includes(d.status)) {
      const texts = pending[d.mode], at = texts.indexOf(d.text);
      if (at >= 0) { texts.splice(at, 1); d.status = "cancelled"; count++; }
    }
    this.#persist(record); this.#emit(record); return count;
  }
  request<T, C>({ ownerId, title, run }: { ownerId: string; title: string; run: (ctx: C, signal?: AbortSignal) => Promise<T> }, signal?: AbortSignal): Promise<T> {
    if (this.#disposed || signal?.aborted) return Promise.reject(signal?.reason || new Error("Session closed."));
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const cleanup = () => { signal?.removeEventListener("abort", cancel); this.#questions.delete(id); this.#emit(); };
      const cancel = () => { cleanup(); reject(signal?.reason || new Error("Question cancelled.")); };
      const question: HubQuestion = { id, ownerId, title, answering: false, cancel, answer: async (ctx: unknown): Promise<void> => {
        if (question.answering || signal?.aborted || !this.#questions.has(id)) throw new Error("Question is no longer pending.");
        question.answering = true; this.#emit();
        try { const value = await run(ctx as C, signal); signal?.throwIfAborted(); resolve(value); }
        catch (error) { reject(error); throw error; }
        finally { cleanup(); }
      } };
      this.#questions.set(id, question); signal?.addEventListener("abort", cancel, { once: true }); this.#emit();
    });
  }
  questions(): HubQuestion[] { return [...this.#questions.values()]; }
  async related(id: string, text: string): Promise<string> {
    const record = this.get(id);
    if (!record?.closed || !record.file || !this.onRelated) throw new Error("A related investigation is unavailable for this thread.");
    return this.onRelated(record, text);
  }
  flush(): void { for (const id of this.#draftTimers.keys()) this.flushDraft(id); }
  dispose(): void {
    this.flush(); this.#disposed = true;
    for (const question of this.#questions.values()) question.cancel();
    for (const r of this.list()) r.unsubscribe?.();
    this.#records.clear(); this.#listeners.clear(); this.#pins.clear();
  }
}
