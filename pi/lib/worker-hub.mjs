const maxRecent = 12;
const guarded = text => `Human instruction for the current approved contract:\n${text}\n\nStay within the approved contract/spec. If this instruction requires replanning or conflicts with them, stop and return NEEDS_REPLAN with precise evidence.`;

function usage(messages = []) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  for (const message of messages) {
    if (!message.usage) continue;
    for (const key of Object.keys(totals)) totals[key] += message.usage[key] || 0;
  }
  return totals;
}

export class WorkerHub {
  #records = new Map();
  #listeners = new Set();
  #sequence = 0;

  nextId(role) { return `${role}:${++this.#sequence}`; }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #emit() { for (const listener of this.#listeners) listener(this.list()); }

  register({ id, label, role, model, thinking, session, metadata = {} }) {
    if (this.#records.has(id)) throw new Error(`Worker ${id} is already registered.`);
    const record = { id, label, role, model, thinking, session, metadata, state: "working", activity: "starting", startedAt: Date.now(), endedAt: null, messages: session.messages || [], stats: usage(session.messages) };
    record.unsubscribe = session.subscribe(event => {
      record.messages = session.messages || record.messages;
      record.stats = usage(record.messages);
      if (event.type === "tool_execution_start") record.activity = `${event.toolName}${event.args?.path ? ` ${event.args.path}` : ""}`;
      else if (event.type === "message_update") record.activity = "responding";
      else if (event.type === "agent_start") record.activity = "thinking";
      else if (event.type === "agent_end") record.activity = "finishing";
      this.#emit();
    });
    this.#records.set(id, record); this.#emit();
    return id;
  }

  update(id, patch) {
    const record = this.#records.get(id);
    if (!record) return false;
    Object.assign(record, patch); this.#emit(); return true;
  }

  unregister(id, state = "completed") {
    const record = this.#records.get(id);
    if (!record) return false;
    record.unsubscribe?.(); record.unsubscribe = undefined;
    record.messages = [...(record.session?.messages || record.messages || [])];
    record.stats = usage(record.messages); record.session = undefined;
    record.state = state; record.activity = state; record.endedAt = Date.now();
    const recent = [...this.#records.values()].filter(item => item.endedAt).sort((a, b) => b.endedAt - a.endedAt);
    for (const stale of recent.slice(maxRecent)) this.#records.delete(stale.id);
    this.#emit(); return true;
  }

  list() { return [...this.#records.values()].sort((a, b) => (a.endedAt ? 1 : 0) - (b.endedAt ? 1 : 0) || b.startedAt - a.startedAt); }
  get(id) { return this.#records.get(id); }
  async steer(id, text) {
    const record = this.#records.get(id);
    if (!record?.session || record.state !== "working") throw new Error("Worker is no longer running.");
    await record.session.steer(guarded(text));
    this.update(id, { activity: "steer queued" });
  }
  async followUp(id, text) {
    const record = this.#records.get(id);
    if (!record?.session || record.state !== "working") throw new Error("Worker is no longer running.");
    await record.session.followUp(guarded(text));
    this.update(id, { activity: "follow-up queued" });
  }
  async abort(id) {
    const record = this.#records.get(id);
    if (!record?.session || record.state !== "working") return false;
    this.update(id, { state: "aborting", activity: "abort requested" });
    await record.session.abort(); return true;
  }
  dispose() {
    for (const record of this.#records.values()) record.unsubscribe?.();
    this.#records.clear(); this.#listeners.clear();
  }
}
