import { randomUUID } from "node:crypto";

export type DeliveryMode = "steer" | "followUp";
export type WorkerState = "working" | "completed" | "failed" | "aborted" | "interrupted" | "aborting" | string;
export type UsageKey = "input" | "output" | "cacheRead" | "cacheWrite" | "totalTokens";
export type WorkerStats = Record<UsageKey, number | null> & {
  cost: number | null;
  requests: number;
  tools: number;
};
export type WorkerDelivery = {
  id: string;
  text: string;
  mode: DeliveryMode;
  status: "sending" | "queued" | "delivered" | "failed" | "cancelled";
  at: number;
  deliveredAt?: number;
  error?: string;
};
export type WorkerMessage = {
  role: string;
  content?: string | Array<Record<string, unknown>>;
  usage?: Partial<Record<UsageKey, number>> & { cost?: { total?: number } };
  toolCallId?: string;
  toolName?: string;
  output?: string;
  stopReason?: string;
  errorMessage?: string;
};
export type WorkerActions = {
  send?(text: string, mode: DeliveryMode): Promise<void>;
  stop?(): Promise<void>;
  cancelQueued?(): { steering: string[]; followUp: string[] } | Promise<{ steering: string[]; followUp: string[] }>;
};
export type WorkerSession = {
  messages?: WorkerMessage[];
  sessionFile?: string;
  sessionManager?: {
    getSessionFile?(): string | undefined;
    appendCustomEntry?(type: string, data: unknown): void;
  };
  subscribe(listener: (event: WorkerEvent) => void): () => void;
  getContextUsage?(): unknown;
  steer?(text: string): Promise<void>;
  followUp?(text: string): Promise<void>;
  abort(): Promise<void>;
};
export type WorkerRecord = {
  id: string;
  label: string;
  role: string;
  model?: string;
  thinking?: string;
  session?: WorkerSession;
  metadata: Record<string, any>;
  actions?: WorkerActions;
  state: WorkerState;
  activity: string;
  accepting?: boolean;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
  messages?: WorkerMessage[];
  stats: WorkerStats;
  context?: any;
  partial?: WorkerMessage;
  tools: Map<string, any>;
  deliveries: WorkerDelivery[];
  draft: string;
  savedDraft?: string;
  version: number;
  unread: boolean;
  closed: boolean;
  seen?: WeakSet<object>;
  file?: string;
  unsubscribe?: () => void;
  outcome?: string;
  storageError?: string;
  queue?: { steering: number; followUp: number };
};
export type WorkerRegistration = {
  id: string;
  label?: string;
  role: string;
  model?: string;
  thinking?: string;
  session: WorkerSession;
  metadata?: Record<string, any>;
  actions?: WorkerActions;
};
type WorkerEvent = {
  type: string;
  message?: WorkerMessage;
  assistantMessageEvent?: { type?: string };
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, any>;
  isError?: boolean;
  errorMessage?: string;
  attempt?: number;
  maxAttempts?: number;
  willRetry?: boolean;
  steering?: unknown[];
  followUp?: unknown[];
  partialResult?: any;
  result?: any;
};
type WorkerHistoryLike = {
  saveMetadata(record: WorkerRecord): void;
  load(record: WorkerRecord): WorkerMessage[];
  saveDraft(record: WorkerRecord, text: string): void;
};
type WorkerHubOptions = {
  history?: WorkerHistoryLike;
  onError?: (error: Error) => void;
  onRelated?: (record: WorkerRecord, text: string) => Promise<string>;
};
export type WorkerQuestion = {
  id: string;
  ownerId: string;
  title: string;
  answering: boolean;
  cancel(): void;
  answer(ctx: unknown): Promise<void>;
};

const tokens: readonly UsageKey[] = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
const textOf = (message?: WorkerMessage): string => {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part): part is Record<string, unknown> & { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map(part => part.text)
    .join("\n");
};
export const isActive = (record?: WorkerRecord): boolean => !!record?.session && !record.closed;
const emptyStats = (): WorkerStats => ({ input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null, cost: null, requests: 0, tools: 0 });
function addUsage(stats: WorkerStats, message: WorkerMessage): void {
  if (message.role !== "assistant") return;
  stats.requests++;
  stats.tools += Array.isArray(message.content) ? message.content.filter(part => part.type === "toolCall").length : 0;
  if (!message.usage) return;
  for (const key of tokens) {
    const value = message.usage[key];
    if (typeof value === "number" && Number.isFinite(value)) stats[key] = (stats[key] ?? 0) + value;
  }
  const cost = message.usage.cost?.total;
  if (typeof cost === "number" && Number.isFinite(cost)) stats.cost = (stats.cost ?? 0) + cost;
}
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Presentation + owner-supplied actions, never workflow policy or spawning. */
export class WorkerHub {
  #records = new Map<string, WorkerRecord>();
  #listeners = new Set<(records: WorkerRecord[], record?: WorkerRecord) => void>();
  #disposed = false;
  #history?: WorkerHistoryLike;
  #draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #pins = new Map<string, number>();
  #questions = new Map<string, WorkerQuestion>();
  readonly onError: (error: Error) => void;
  onRelated?: (record: WorkerRecord, text: string) => Promise<string>;

  constructor({ history, onError = () => {}, onRelated }: WorkerHubOptions = {}) {
    this.#history = history; this.onError = onError; this.onRelated = onRelated;
  }
  setHistory(history?: WorkerHistoryLike): void { this.#history = history; }
  nextId(role: string): string { return `${role}:${randomUUID()}`; }
  subscribe(listener: (records: WorkerRecord[], record?: WorkerRecord) => void): () => void {
    this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }
  #warn(error: unknown): void { try { this.onError(error instanceof Error ? error : new Error(String(error))); } catch { /* reporting must not break execution */ } }
  #emit(record?: WorkerRecord): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) {
      try { listener(this.list(), record); } catch (error: unknown) { this.#warn(error); }
    }
  }
  #persist(record: WorkerRecord): void {
    try { this.#history?.saveMetadata(record); }
    catch (error: unknown) { record.storageError = errorMessage(error); this.#warn(error); }
  }

  register({ id, label, role, model, thinking, session, metadata = {}, actions }: WorkerRegistration): string {
    if (this.#disposed) throw new Error("Agent Hub is closed.");
    if (this.#records.has(id)) throw new Error(`Worker ${id} is already registered.`);
    const messages = [...(session.messages || [])];
    const record: WorkerRecord = {
      id, label: label || id, role, model, thinking, session, metadata, actions,
      state: "working", activity: "Starting", startedAt: Date.now(), updatedAt: Date.now(), endedAt: null,
      messages, stats: emptyStats(), context: undefined, partial: undefined, tools: new Map(),
      deliveries: [], draft: "", version: 0, unread: true, closed: false, seen: new WeakSet<object>(messages.filter((message): message is WorkerMessage & object => typeof message === "object" && message !== null)),
      file: session.sessionFile ?? session.sessionManager?.getSessionFile?.(),
    };
    for (const message of messages) addUsage(record.stats, message);
    record.unsubscribe = session.subscribe(event => {
      try { this.#event(record, event); } catch (error: unknown) { this.#warn(error); }
    });
    this.#records.set(id, record); this.#persist(record); this.#emit(record);
    return id;
  }

  #event(record: WorkerRecord, event: WorkerEvent): void {
    if (record.closed || this.#disposed) return;
    record.updatedAt = Date.now();
    const { type } = event;
    if (type === "message_start" && event.message?.role === "user") {
      const text = textOf(event.message);
      const delivery = record.deliveries.find(d => ["sending", "queued"].includes(d.status) && d.text === text);
      if (delivery) { delivery.status = "delivered"; delivery.deliveredAt = Date.now(); this.#persist(record); }
    }
    if (type === "message_update" && event.message) {
      record.partial = event.message;
      record.activity = event.assistantMessageEvent?.type?.startsWith("thinking") ? "Thinking" : "Responding";
      record.version++;
    } else if (type === "message_end" && event.message) {
      const seen = record.seen ??= new WeakSet<object>();
      const objectMessage = event.message as WorkerMessage & object;
      const fresh = !seen.has(objectMessage);
      seen.add(objectMessage);
      if (fresh) (record.messages ??= []).push(event.message);
      if (event.message.role === "assistant") record.partial = undefined;
      if (event.message.role === "toolResult" && event.message.toolCallId) record.tools.delete(event.message.toolCallId);
      if (fresh) addUsage(record.stats, event.message);
      record.version++; record.unread = true;
      record.context = record.session?.getContextUsage?.();
    } else if ((type === "tool_execution_start" || type === "tool_execution_update") && event.toolCallId) {
      record.tools.set(event.toolCallId, { ...record.tools.get(event.toolCallId), ...event });
      const detail = event.args?.path || event.args?.command || event.args?.query || "";
      record.activity = `${event.toolName || "tool"}${detail ? ` ${String(detail).replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
      record.version++;
    } else if (type === "tool_execution_end" && event.toolCallId) {
      record.tools.set(event.toolCallId, { ...record.tools.get(event.toolCallId), ...event });
      record.activity = event.isError ? `${event.toolName || "tool"} failed` : `${event.toolName || "tool"} finished`;
      record.version++; record.unread = true;
    } else if (type === "agent_start") record.activity = "Waiting for model";
    else if (type === "compaction_start") record.activity = "Compacting context";
    else if (type === "compaction_end") {
      record.context = record.session?.getContextUsage?.();
      record.activity = event.errorMessage ? `Compaction failed: ${event.errorMessage}` : "Context compacted";
    } else if (type === "auto_retry_start") record.activity = `Provider retry ${event.attempt ?? "?"}/${event.maxAttempts ?? "?"}`;
    else if (type === "agent_end") record.activity = event.willRetry ? "Retrying" : "Finishing";
    else if (type === "agent_settled") record.activity = "Settled";
    else if (type === "queue_update") record.queue = { steering: event.steering?.length ?? 0, followUp: event.followUp?.length ?? 0 };
    this.#emit(record);
  }

  restore(data: WorkerRecord): void {
    if (this.#disposed || this.#records.has(data.id)) return;
    this.#records.set(data.id, { ...data, stats: data.stats || emptyStats(), metadata: data.metadata || {}, tools: new Map(), deliveries: data.deliveries || [], draft: data.draft || "", version: 0, unread: false, closed: true });
    this.#emit(this.get(data.id));
  }
  update(id: string, patch: Partial<Pick<WorkerRecord, "label" | "metadata" | "state" | "activity" | "accepting" | "outcome" | "context">>): boolean {
    const record = this.get(id); if (!record) return false;
    Object.assign(record, patch);
    record.updatedAt = Date.now();
    if (record.closed) this.#persist(record);
    this.#emit(record); return true;
  }
  seal(id: string): void { const record = this.get(id); if (record) { record.accepting = false; this.#emit(record); } }
  unregister(id?: string, state: WorkerState = "completed"): boolean {
    if (!id) return false;
    const record = this.get(id); if (!record || record.closed) return false;
    record.unsubscribe?.(); record.unsubscribe = undefined;
    record.state = state; record.activity = state === "completed" ? "Worker finished" : state;
    record.endedAt = Date.now(); record.closed = true; record.accepting = false; record.unread = true;
    for (const d of record.deliveries) if (["queued", "sending"].includes(d.status)) {
      d.status = "failed"; d.error = "Agent stopped before delivery. Restore this message to send it elsewhere.";
    }
    this.flushDraft(id); this.#persist(record);
    record.session = undefined; record.actions = undefined; record.partial = undefined; record.tools.clear();
    this.#trim(); this.#emit(record); return true;
  }
  list(): WorkerRecord[] { return [...this.#records.values()]; }
  get(id?: string): WorkerRecord | undefined { return id ? this.#records.get(id) : undefined; }
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
      catch (error: unknown) { record.storageError = errorMessage(error); throw error; }
    }
    record.unread = false;
    return record;
  }
  setDraft(id: string, text: string): void {
    const record = this.get(id); if (!record) return;
    record.draft = text;
    clearTimeout(this.#draftTimers.get(id));
    const timer = setTimeout(() => this.flushDraft(id), 250); timer.unref?.();
    this.#draftTimers.set(id, timer);
  }
  flushDraft(id?: string): void {
    if (!id) return;
    clearTimeout(this.#draftTimers.get(id)); this.#draftTimers.delete(id);
    const record = this.get(id); if (!record || record.savedDraft === record.draft) return;
    try { this.#history?.saveDraft(record, record.draft); record.savedDraft = record.draft; }
    catch (error: unknown) { record.storageError = errorMessage(error); this.#warn(error); }
  }
  canSend(id: string): boolean {
    const r = this.get(id);
    if (!r || !isActive(r)) return false;\n    return !!(r.accepting !== false && r.state === "working" && (r.actions?.send || r.session?.steer));
  }
  async send(id: string, text: string, mode: DeliveryMode = "steer"): Promise<WorkerDelivery> {
    if (!["steer", "followUp"].includes(mode)) throw new Error("Unknown delivery mode.");
    if (!text.trim()) throw new Error("Message is empty.");
    const record = this.get(id);
    if (!record || !this.canSend(id)) throw new Error("Agent is no longer accepting messages. Your draft is preserved.");
    const delivery: WorkerDelivery = { id: randomUUID(), text, mode, status: "sending", at: Date.now() };
    record.deliveries.push(delivery); this.#persist(record); this.#emit(record);
    try {
      if (record.actions?.send) await record.actions.send(text, mode);
      else {
        const send = record.session?.[mode];
        if (!send) throw new Error("Agent owner cannot accept messages.");
        await send.call(record.session, text);
      }
      if (delivery.status === "failed" || (record.closed && delivery.status !== "delivered")) throw new Error(delivery.error || "Agent finished before delivery.");
      if (delivery.status === "sending") delivery.status = "queued";
      return delivery;
    } catch (error: unknown) {
      delivery.status = "failed"; delivery.error = errorMessage(error);
      throw error;
    } finally { this.#persist(record); this.#emit(record); }
  }
  steer(id: string, text: string): Promise<WorkerDelivery> { return this.send(id, text, "steer"); }
  followUp(id: string, text: string): Promise<WorkerDelivery> { return this.send(id, text, "followUp"); }
  async abort(id: string): Promise<boolean> {
    const record = this.get(id);
    if (!record || !isActive(record) || record.state === "aborting") return false;
    const previous = record.state;
    this.update(id, { state: "aborting", accepting: false, activity: "Stopping; completed effects are not undone" });
    try {
      if (record.actions?.stop) await record.actions.stop(); else await record.session!.abort();
      return true;
    } catch (error: unknown) {
      this.update(id, { state: previous, activity: `Stop failed: ${errorMessage(error)}` }); throw error;
    }
  }
  async cancelQueued(id: string): Promise<number> {
    const record = this.get(id);
    if (!record || !isActive(record) || !record.actions?.cancelQueued) throw new Error("This owner cannot cancel a queue.");
    const removed = await record.actions.cancelQueued();
    const texts = [...removed.steering, ...removed.followUp];
    let count = 0;
    for (const d of record.deliveries) if (["sending", "queued"].includes(d.status)) {
      const at = texts.indexOf(d.text);
      if (at >= 0) { texts.splice(at, 1); d.status = "cancelled"; count++; }
    }
    this.#persist(record); this.#emit(record); return count;
  }
  request<T>({ ownerId, title, run }: { ownerId: string; title: string; run: (ctx: unknown, signal?: AbortSignal) => Promise<T> }, signal?: AbortSignal): Promise<T> {
    if (this.#disposed || signal?.aborted) return Promise.reject(signal?.reason || new Error("Session closed."));
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const cleanup = () => { signal?.removeEventListener("abort", cancel); this.#questions.delete(id); this.#emit(); };
      const cancel = () => { cleanup(); reject(signal?.reason || new Error("Question cancelled.")); };
      const question: WorkerQuestion = { id, ownerId, title, answering: false, cancel, answer: async (ctx: unknown) => {
        if (question.answering || signal?.aborted || !this.#questions.has(id)) return;
        question.answering = true; this.#emit();
        try { const value = await run(ctx, signal); signal?.throwIfAborted(); resolve(value); }
        catch (error: unknown) { reject(error); }
        finally { cleanup(); }
      } };
      this.#questions.set(id, question); signal?.addEventListener("abort", cancel, { once: true }); this.#emit();
    });
  }
  questions(): WorkerQuestion[] { return [...this.#questions.values()]; }
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
