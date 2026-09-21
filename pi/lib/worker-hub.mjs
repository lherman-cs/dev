import { randomUUID } from "node:crypto";

const contentText = content => typeof content === "string" ? content : (content || []).filter(p => p.type === "text").map(p => p.text).join("\n");
const terminalStates = new Set(["completed", "failed", "aborted", "interrupted"]);
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** A projection of externally owned sessions, never a scheduler or workflow authority. */
export class WorkerHub {
  #records = new Map();
  #listeners = new Set();
  #questions = new Map();
  #closed = false;
  #clock;
  history;
  workflow = null;
  lastUIError = null;

  constructor({ history, now = Date.now } = {}) { this.history = history; this.#clock = now; }
  nextId(role) { return `${role}:${randomUUID()}`; }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #emit() {
    if (this.#closed) return;
    for (const listener of this.#listeners) {
      try { listener(this.list()); } catch (error) { this.lastUIError = String(error?.message || error); }
    }
  }
  #persist(record) {
    try { this.history?.record(record); } catch (error) { record.historyError = `History could not be saved: ${error.message}`; }
  }

  register({ id, label, role, model, thinking, session, metadata = {}, controls = {}, state }) {
    if (this.#closed) throw new Error("Agent Hub is closed.");
    if (this.#records.has(id)) throw new Error(`Worker ${id} is already registered.`);
    const now = this.#clock();
    const record = {
      id, label: label || role || id, role, model, thinking, metadata, controls,
      state: state || (session ? "working" : "starting"), activity: "Starting",
      startedAt: now, updatedAt: now, endedAt: null, revision: 0,
      messages: [], streaming: null, liveTools: new Map(), receipts: [],
      stats: { input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null, cost: null, requests: 0, tools: 0 },
      context: null, seen: new WeakSet(), loaded: true,
    };
    this.#records.set(id, record);
    if (session) this.attach(id, session);
    this.#persist(record); this.#emit();
    return id;
  }

  attach(id, session) {
    const record = this.get(id);
    if (!record || terminalStates.has(record.state)) throw new Error("Cannot attach to a finished worker.");
    record.unsubscribe?.();
    record.session = session;
    record.sessionFile = session.sessionFile;
    for (const message of session.messages || []) this.#message(record, message);
    record.unsubscribe = session.subscribe(event => this.#event(record, event));
    this.#persist(record); this.#emit();
  }

  #message(record, message) {
    if (!message || record.seen.has(message) || message.role === "system") return;
    record.seen.add(message);
    record.messages.push(message);
    if (message.role !== "assistant") return;
    record.stats.requests++;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) {
      const n = number(message.usage?.[key]);
      if (n !== null) record.stats[key] = (record.stats[key] ?? 0) + n;
    }
    const cost = number(message.usage?.cost?.total);
    if (cost !== null) record.stats.cost = (record.stats.cost ?? 0) + cost;
  }

  #event(record, event) {
    if (!record.session || this.#closed) return;
    record.updatedAt = this.#clock(); record.revision++;
    if (event.type === "message_start" && event.message?.role === "user") {
      const text = contentText(event.message.content);
      const receipt = record.receipts.find(r => ["sending", "queued"].includes(r.state) && r.wireText === text);
      if (receipt) { receipt.state = "delivered"; receipt.deliveredAt = this.#clock(); this.#persist(record); }
    }
    if (event.type === "message_update") {
      record.streaming = event.message || record.session.agent?.state?.streamingMessage || null;
      record.activity = "Responding";
    } else if (event.type === "message_end") {
      this.#message(record, event.message);
      if (event.message?.role === "assistant") record.streaming = null;
      if (event.message?.role === "toolResult") record.liveTools.delete(event.message.toolCallId);
      try { record.context = record.session.getContextUsage?.() || null; } catch { record.context = null; }
    } else if (event.type === "tool_execution_start") {
      record.stats.tools++;
      record.liveTools.set(event.toolCallId, { ...event, revision: 0, state: "running" });
      const detail = event.args?.path || event.args?.file_path || event.args?.command || event.args?.query || "";
      record.activity = `${event.toolName}${detail ? ` ${String(detail).replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
    } else if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
      const tool = record.liveTools.get(event.toolCallId) || { ...event, revision: 0 };
      Object.assign(tool, { result: event.partialResult || event.result, isError: !!event.isError,
        state: event.type === "tool_execution_end" ? "finished" : "running", revision: tool.revision + 1 });
      record.liveTools.set(event.toolCallId, tool);
    } else if (event.type === "agent_start") record.activity = "Thinking";
    else if (event.type === "agent_end") record.activity = "Settling";
    else if (event.type === "auto_retry_start") record.activity = "Retrying provider request";
    else if (["compaction_start", "auto_compaction_start"].includes(event.type)) record.activity = "Compacting context";
    else if (["compaction_end", "auto_compaction_end", "session_compact"].includes(event.type)) record.context = null;
    this.#emit();
  }

  update(id, patch) {
    const record = this.get(id);
    if (!record || this.#closed) return false;
    // Identity, transcript, and control handles cannot be replaced by display updates.
    for (const key of ["label", "activity", "state", "outcome", "error", "context", "metadata"]) {
      if (Object.hasOwn(patch, key)) record[key] = patch[key];
    }
    record.updatedAt = this.#clock(); record.revision++;
    this.#persist(record); this.#emit(); return true;
  }

  unregister(id, state = "completed") {
    const record = this.get(id);
    if (!record || record.endedAt !== null) return false;
    record.unsubscribe?.(); record.unsubscribe = undefined;
    for (const message of record.session?.messages || []) this.#message(record, message);
    try { record.context = record.session?.getContextUsage?.() || record.context; } catch { /* final snapshot is best effort */ }
    record.session = undefined; record.controls = {};
    record.state = state; record.activity = state === "completed" ? "Agent finished" : state;
    record.endedAt = this.#clock(); record.updatedAt = record.endedAt; record.revision++;
    record.streaming = null;
    for (const receipt of record.receipts) {
      if (["sending", "queued"].includes(receipt.state)) {
        receipt.state = "undelivered"; receipt.error = "Agent finished before delivery. The original message is retained.";
      }
    }
    this.#persist(record);
    // Keep every identity. Only evict reloadable transcript bodies, never the selected recipient.
    if (this.history) {
      const cached = this.list().filter(r => r.endedAt !== null && r.loaded && r.sessionFile);
      for (const old of cached.slice(0, Math.max(0, cached.length - 12))) {
        old.messages = []; old.liveTools.clear(); old.loaded = false;
      }
    }
    this.#emit(); return true;
  }

  restore(records) {
    for (const saved of records) {
      if (!saved?.id || this.#records.has(saved.id)) continue;
      this.#records.set(saved.id, { ...saved, controls: {}, session: undefined, streaming: null,
        state: terminalStates.has(saved.state) ? saved.state : "interrupted",
        activity: terminalStates.has(saved.state) ? saved.activity : "Previous process ended; inspect before resuming",
        endedAt: saved.endedAt ?? saved.updatedAt, messages: [], liveTools: new Map(), receipts: (saved.receipts || []).map(receipt => ["sending", "queued"].includes(receipt.state)
          ? { ...receipt, state: "undelivered", error: "The previous process ended before delivery was confirmed. Original text retained." } : { ...receipt }),
        revision: 0, loaded: false, seen: new WeakSet() });
    }
    this.#emit();
  }
  async load(id) {
    const record = this.get(id);
    if (!record || record.loaded || !this.history) return record;
    if (!record.loading) record.loading = Promise.resolve().then(() => this.history.load(record)).then(messages => {
      record.messages = messages; record.loaded = true; record.historyError = undefined; record.revision++;
      return record;
    }).catch(error => { record.historyError = `Cannot open history: ${error.message}`; return record; })
      .finally(() => { record.loading = undefined; this.#emit(); });
    return record.loading;
  }
  list() { return [...this.#records.values()]; } // Stable creation order; activity never moves a row.
  get(id) { return this.#records.get(id); }

  async send(id, text, mode = "steer") {
    const record = this.get(id);
    if (!record || record.state !== "working" || !record.controls.send) throw new Error("This attempt no longer accepts messages. Your draft is unchanged.");
    if (!text.trim()) throw new Error("Write a message first.");
    if (!["steer", "followUp"].includes(mode)) throw new Error("Unknown delivery mode.");
    const receipt = { id: randomUUID(), workerId: id, text, wireText: text, mode, state: "sending", timestamp: this.#clock() };
    record.receipts.push(receipt); this.#emit();
    try {
      await record.controls.send(text, mode, receipt);
      if (receipt.state === "undelivered") throw new Error(receipt.error);
      if (receipt.state === "sending") receipt.state = "queued";
      return receipt;
    } catch (error) {
      receipt.state = "undelivered"; receipt.error = error.message || String(error); throw error;
    } finally { this.#persist(record); this.#emit(); }
  }
  steer(id, text) { return this.send(id, text, "steer"); }
  followUp(id, text) { return this.send(id, text, "followUp"); }
  async cancelMessage(id, receiptId) {
    const record = this.get(id), receipt = record?.receipts.find(r => r.id === receiptId);
    if (!receipt || !["queued", "sending"].includes(receipt.state) || !record.controls.cancelMessage) throw new Error("This message can no longer be cancelled.");
    await record.controls.cancelMessage(receipt);
    receipt.state = "cancelled"; this.#persist(record); this.#emit();
  }
  async abort(id) {
    const record = this.get(id);
    if (!record?.controls.stop || terminalStates.has(record.state) || record.state === "aborting") return false;
    const stop = record.controls.stop;
    this.update(id, { state: "aborting", activity: "Cancellation requested; existing changes are not reverted" });
    await stop(); return true;
  }
  async stopAll() { await Promise.allSettled(this.list().map(r => this.abort(r.id))); }
  setWorkflow(workflow) { this.workflow = workflow; this.#emit(); }

  request({ ownerId = "main", title, run }, signal) {
    if (this.#closed || signal?.aborted) return Promise.reject(signal?.reason || new Error("Session closed."));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const cleanup = () => { signal?.removeEventListener("abort", abort); this.#questions.delete(id); this.#emit(); };
      const abort = () => { cleanup(); reject(signal?.reason || new Error("Request cancelled.")); };
      const question = { id, ownerId, title, signal, answering: false,
        answer: async ctx => {
          if (question.answering || signal?.aborted) return;
          question.answering = true; this.#emit();
          try { const value = await run(ctx, signal); if (!signal?.aborted) resolve(value); }
          catch (error) { reject(error); }
          finally { cleanup(); }
        }, cancel: abort };
      this.#questions.set(id, question);
      signal?.addEventListener("abort", abort, { once: true }); this.#emit();
    });
  }
  questions() { return [...this.#questions.values()]; }
  dispose() {
    if (this.#closed) return;
    this.#closed = true;
    for (const question of this.#questions.values()) question.cancel();
    for (const record of this.#records.values()) record.unsubscribe?.();
    this.#listeners.clear();
  }
}
