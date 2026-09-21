import { randomUUID } from "node:crypto";

const tokens = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
const textOf = message => typeof message?.content === "string" ? message.content : (message?.content || []).filter(p => p.type === "text").map(p => p.text).join("\n");
export const isActive = record => !!record?.session && !record.closed;
const emptyStats = () => ({ input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null, cost: null, requests: 0, tools: 0 });
function addUsage(stats, message) {
  if (message.role !== "assistant") return;
  stats.requests++;
  stats.tools += Array.isArray(message.content) ? message.content.filter(p => p.type === "toolCall").length : 0;
  if (!message.usage) return;
  for (const key of tokens) if (Number.isFinite(message.usage[key])) stats[key] = (stats[key] ?? 0) + message.usage[key];
  if (Number.isFinite(message.usage.cost?.total)) stats.cost = (stats.cost ?? 0) + message.usage.cost.total;
}

/** Presentation + owner-supplied actions, never workflow policy or spawning. */
export class WorkerHub {
  #records = new Map();
  #listeners = new Set();
  #disposed = false;
  #history;
  #draftTimers = new Map();
  #pins = new Map();
  #questions = new Map();
  constructor({ history, onError = () => {}, onRelated } = {}) {
    this.#history = history; this.onError = onError; this.onRelated = onRelated;
  }
  setHistory(history) { this.#history = history; }
  nextId(role) { return `${role}:${randomUUID()}`; }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #warn(error) { try { this.onError(error instanceof Error ? error : new Error(String(error))); } catch { /* reporting must not break execution */ } }
  #emit(record) {
    if (this.#disposed) return;
    for (const listener of this.#listeners) {
      try { listener(this.list(), record); } catch (error) { this.#warn(error); }
    }
  }
  #persist(record) { try { this.#history?.saveMetadata(record); } catch (error) { record.storageError = error.message; this.#warn(error); } }

  register({ id, label, role, model, thinking, session, metadata = {}, actions }) {
    if (this.#disposed) throw new Error("Agent Hub is closed.");
    if (this.#records.has(id)) throw new Error(`Worker ${id} is already registered.`);
    const messages = [...(session.messages || [])];
    const record = {
      id, label: label || id, role, model, thinking, session, metadata, actions,
      state: "working", activity: "Starting", startedAt: Date.now(), updatedAt: Date.now(), endedAt: null,
      messages, stats: emptyStats(), context: undefined, partial: undefined, tools: new Map(),
      deliveries: [], draft: "", version: 0, unread: true, closed: false, seen: new WeakSet(messages),
      file: session.sessionFile ?? session.sessionManager?.getSessionFile?.(),
    };
    for (const message of messages) addUsage(record.stats, message);
    record.unsubscribe = session.subscribe(event => {
      try { this.#event(record, event); } catch (error) { this.#warn(error); }
    });
    this.#records.set(id, record); this.#persist(record); this.#emit(record);
    return id;
  }

  #event(record, event) {
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
      if (fresh) record.messages.push(event.message);
      if (event.message.role === "assistant") record.partial = undefined;
      if (event.message.role === "toolResult") record.tools.delete(event.message.toolCallId);
      if (fresh) addUsage(record.stats, event.message);
      record.version++; record.unread = true;
      record.context = record.session.getContextUsage?.();
    } else if (type === "tool_execution_start" || type === "tool_execution_update") {
      record.tools.set(event.toolCallId, { ...record.tools.get(event.toolCallId), ...event });
      const detail = event.args?.path || event.args?.command || event.args?.query || "";
      record.activity = `${event.toolName}${detail ? ` ${String(detail).replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
      record.version++;
    } else if (type === "tool_execution_end") {
      record.tools.set(event.toolCallId, { ...record.tools.get(event.toolCallId), ...event });
      record.activity = event.isError ? `${event.toolName} failed` : `${event.toolName} finished`;
      record.version++; record.unread = true;
    } else if (type === "agent_start") record.activity = "Waiting for model";
    else if (type === "compaction_start") record.activity = "Compacting context";
    else if (type === "compaction_end") {
      record.context = record.session.getContextUsage?.();
      record.activity = event.errorMessage ? `Compaction failed: ${event.errorMessage}` : "Context compacted";
    } else if (type === "auto_retry_start") record.activity = `Provider retry ${event.attempt}/${event.maxAttempts}`;
    else if (type === "agent_end") record.activity = event.willRetry ? "Retrying" : "Finishing";
    else if (type === "agent_settled") record.activity = "Settled";
    else if (type === "queue_update") record.queue = { steering: event.steering.length, followUp: event.followUp.length };
    this.#emit(record);
  }

  restore(data) {
    if (this.#disposed || this.#records.has(data.id)) return;
    this.#records.set(data.id, { ...data, stats: data.stats || emptyStats(), metadata: data.metadata || {}, tools: new Map(), deliveries: data.deliveries || [], draft: data.draft || "", version: 0, unread: false, closed: true });
    this.#emit(this.get(data.id));
  }
  update(id, patch) {
    const record = this.get(id); if (!record) return false;
    for (const key of ["label", "metadata", "state", "activity", "accepting", "outcome", "context"]) if (Object.hasOwn(patch, key)) record[key] = patch[key];
    record.updatedAt = Date.now();
    if (record.closed) this.#persist(record);
    this.#emit(record); return true;
  }
  seal(id) { const record = this.get(id); if (record) { record.accepting = false; this.#emit(record); } }
  unregister(id, state = "completed") {
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
  list() { return [...this.#records.values()]; } // Stable order: activity never moves a target under the cursor.
  get(id) { return this.#records.get(id); }
  pin(id) {
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
  #trim() {
    const cached = this.list().filter(r => r.closed && r.messages && r.file && !this.#pins.get(r.id));
    for (const record of cached.slice(0, -12)) record.messages = undefined;
  }
  load(id) {
    const record = this.get(id); if (!record) throw new Error("Thread is no longer available.");
    if (!record.messages) {
      try { record.messages = this.#history?.load(record) || []; record.version++; }
      catch (error) { record.storageError = error.message; throw error; }
    }
    record.unread = false;
    return record;
  }
  setDraft(id, text) {
    const record = this.get(id); if (!record) return;
    record.draft = text;
    clearTimeout(this.#draftTimers.get(id));
    this.#draftTimers.set(id, setTimeout(() => this.flushDraft(id), 250));
    this.#draftTimers.get(id).unref?.();
  }
  flushDraft(id) {
    clearTimeout(this.#draftTimers.get(id)); this.#draftTimers.delete(id);
    const record = this.get(id); if (!record || record.savedDraft === record.draft) return;
    try { this.#history?.saveDraft(record, record.draft); record.savedDraft = record.draft; }
    catch (error) { record.storageError = error.message; this.#warn(error); }
  }
  canSend(id) {
    const r = this.get(id);
    return !!(isActive(r) && r.accepting !== false && r.state === "working" && (r.actions?.send || r.session?.steer));
  }
  async send(id, text, mode = "steer") {
    if (!["steer", "followUp"].includes(mode)) throw new Error("Unknown delivery mode.");
    if (!text?.trim()) throw new Error("Message is empty.");
    const record = this.get(id);
    if (!this.canSend(id)) throw new Error("Agent is no longer accepting messages. Your draft is preserved.");
    const delivery = { id: randomUUID(), text, mode, status: "sending", at: Date.now() };
    record.deliveries.push(delivery); this.#persist(record); this.#emit(record);
    try {
      if (record.actions?.send) await record.actions.send(text, mode);
      else await record.session[mode](text);
      if (delivery.status === "failed" || (record.closed && delivery.status !== "delivered")) throw new Error(delivery.error || "Agent finished before delivery.");
      if (delivery.status === "sending") delivery.status = "queued";
      return delivery;
    } catch (error) {
      delivery.status = "failed"; delivery.error = error.message;
      throw error;
    } finally { this.#persist(record); this.#emit(record); }
  }
  steer(id, text) { return this.send(id, text, "steer"); }
  followUp(id, text) { return this.send(id, text, "followUp"); }
  async abort(id) {
    const record = this.get(id);
    if (!isActive(record) || record.state === "aborting") return false;
    const previous = record.state;
    this.update(id, { state: "aborting", accepting: false, activity: "Stopping; completed effects are not undone" });
    try { await (record.actions?.stop ? record.actions.stop() : record.session.abort()); return true; }
    catch (error) { this.update(id, { state: previous, activity: `Stop failed: ${error.message}` }); throw error; }
  }
  async cancelQueued(id) {
    const record = this.get(id);
    if (!isActive(record) || !record.actions?.cancelQueued) throw new Error("This owner cannot cancel a queue.");
    const removed = await record.actions.cancelQueued();
    const texts = [...removed.steering, ...removed.followUp];
    let count = 0;
    for (const d of record.deliveries) if (["sending", "queued"].includes(d.status)) {
      const at = texts.indexOf(d.text);
      if (at >= 0) { texts.splice(at, 1); d.status = "cancelled"; count++; }
    }
    this.#persist(record); this.#emit(record); return count;
  }
  request({ ownerId, title, run }, signal) {
    if (this.#disposed || signal?.aborted) return Promise.reject(signal?.reason || new Error("Session closed."));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const cleanup = () => { signal?.removeEventListener("abort", cancel); this.#questions.delete(id); this.#emit(); };
      const cancel = () => { cleanup(); reject(signal?.reason || new Error("Question cancelled.")); };
      const question = { id, ownerId, title, answering: false, cancel, answer: async ctx => {
        if (question.answering || signal?.aborted || !this.#questions.has(id)) return;
        question.answering = true; this.#emit();
        try { const value = await run(ctx, signal); signal?.throwIfAborted(); resolve(value); }
        catch (error) { reject(error); }
        finally { cleanup(); }
      } };
      this.#questions.set(id, question); signal?.addEventListener("abort", cancel, { once: true }); this.#emit();
    });
  }
  questions() { return [...this.#questions.values()]; }
  async related(id, text) {
    const record = this.get(id);
    if (!record?.closed || !record.file || !this.onRelated) throw new Error("A related investigation is unavailable for this thread.");
    return this.onRelated(record, text);
  }
  flush() { for (const id of this.#draftTimers.keys()) this.flushDraft(id); }
  dispose() {
    this.flush(); this.#disposed = true;
    for (const question of this.#questions.values()) question.cancel();
    for (const r of this.list()) r.unsubscribe?.();
    this.#records.clear(); this.#listeners.clear(); this.#pins.clear();
  }
}
