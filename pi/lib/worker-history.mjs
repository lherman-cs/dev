import fs from "node:fs";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const WORKER_ENTRY = "dev-worker-v1";
export const DRAFT_ENTRY = "dev-worker-draft-v1";
const terminal = new Set(["completed", "failed", "aborted", "interrupted"]);

/** Native Pi JSONL is the only transcript store. No separate index/database. */
export class WorkerHistory {
  constructor(parent, warn = () => {}) {
    this.parent = parent;
    this.warn = warn;
    const file = parent?.getSessionFile?.();
    this.root = file ? `${file}.workers` : undefined;
    const id = parent?.getSessionId?.(), dir = parent?.getSessionDir?.();
    this.legacyRoot = dir && /^[a-zA-Z0-9_-]+$/.test(id || "") ? path.join(dir, ".workers", id) : undefined;
    this.legacy = new Map();
  }

  ensureParent() {
    const file = this.parent?.getSessionFile?.();
    if (!file || fs.existsSync(file)) return;
    // Pi 0.86 defers new files until an assistant speaks. Controller-only Main
    // sessions may never do so. Use the public native SessionManager reload
    // operation after an exact snapshot, preserving id, entries and active leaf;
    // no fabricated assistant turn and no private `flushed` field mutation.
    const required = ["getSessionFile", "getSessionDir", "getSessionId", "getCwd", "getHeader", "getEntries", "getLeafId", "setSessionFile", "branch"];
    const missing = required.filter(name => typeof this.parent?.[name] !== "function");
    if (missing.length) throw new Error(`Early session persistence requires Pi's native session-manager API; missing: ${missing.join(", ")}.`);
    const leaf = this.parent.getLeafId();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, [this.parent.getHeader(), ...this.parent.getEntries()].map(e => JSON.stringify(e)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    this.parent.setSessionFile(file);
    if (leaf !== this.parent.getLeafId()) this.parent.branch(leaf);
  }

  create(cwd, metadata) {
    this.ensureParent();
    if (!this.root) return SessionManager.inMemory(cwd);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const created = SessionManager.create(cwd, this.root, { parentSession: this.parent.getSessionFile() });
    const file = created.getSessionFile();
    // Pi 0.86 defers a new file until the first assistant response. Seed its
    // native header and reopen so an interrupted first request is recoverable.
    fs.writeFileSync(file, `${JSON.stringify(created.getHeader())}\n`, { flag: "wx", mode: 0o600 });
    const manager = SessionManager.open(file, this.root, cwd);
    manager.appendCustomEntry(WORKER_ENTRY, { ...metadata, state: "starting" });
    return manager;
  }

  open(file) {
    if (!this.root || !file) throw new Error("This thread has no saved Pi session.");
    const roots = [this.root, this.legacyRoot].filter(root => root && fs.existsSync(root)).map(root => fs.realpathSync(root));
    const realFile = fs.realpathSync(file);
    if (!roots.includes(path.dirname(realFile)) || !realFile.endsWith(".jsonl")) throw new Error("Child transcript is outside this parent session.");
    const manager = SessionManager.open(realFile, path.dirname(realFile));
    if (path.resolve(manager.getCwd()) !== path.resolve(this.parent.getCwd())) throw new Error("Child transcript belongs to another worktree.");
    return manager;
  }

  read(file) {
    const manager = this.open(file);
    const entries = manager.getEntries();
    const metadata = [...entries].reverse().find(e => e.type === "custom" && e.customType === WORKER_ENTRY)?.data || this.legacy.get(file);
    if (!metadata || typeof metadata.id !== "string") throw new Error("Child session has no worker metadata.");
    const draft = [...entries].reverse().find(e => e.type === "custom" && e.customType === DRAFT_ENTRY)?.data || { text: metadata.draft || "" };
    return {
      ...metadata, file, endedAt: metadata.endedAt || fs.statSync(file).mtimeMs,
      deliveries: (metadata.deliveries || []).map(d => ["sending", "queued"].includes(d.status) ? { ...d, status: "failed", error: "Session interrupted before confirmed delivery. Restore this message from Actions." } : d),
      state: terminal.has(metadata.state) ? metadata.state : "interrupted",
      activity: terminal.has(metadata.state) ? metadata.state : "Interrupted before completion",
      messages: entries.filter(e => e.type === "message" && e.message.role !== "system").map(e => e.message),
      draft: typeof draft?.text === "string" ? draft.text : "",
    };
  }

  // Read the previous PR's native journal without deleting or rewriting it.
  // Only this parent's directory is accepted; no cross-session auto-discovery.
  legacyFiles() {
    const file = this.legacyRoot && path.join(this.legacyRoot, "hub-state.jsonl");
    if (!file || !fs.existsSync(file)) return [];
    const records = new Map(), drafts = new Map();
    for (const entry of this.open(file).getEntries()) {
      if (entry.type !== "custom" || !entry.data?.id) continue;
      if (entry.customType === "dev-worker") records.set(entry.data.id, entry.data);
      if (entry.customType === "dev-draft") drafts.set(entry.data.id, entry.data.text);
    }
    for (const data of records.values()) {
      if (!data.sessionFile) continue;
      this.legacy.set(data.sessionFile, { ...data, file: data.sessionFile, draft: drafts.get(data.id) || "",
        deliveries: (data.receipts || []).map(r => ({ ...r, status: r.state === "undelivered" ? "failed" : r.state, at: r.at || r.createdAt })) });
    }
    return [...this.legacy.keys()];
  }

  /** Metadata only stays resident. Full native histories are loaded on focus. */
  async restore(hub, signal) {
    if (!this.root) return;
    const files = fs.existsSync(this.root) ? fs.readdirSync(this.root).filter(name => name.endsWith(".jsonl")).sort().map(name => path.join(this.root, name)) : [];
    try { files.push(...this.legacyFiles()); } catch (error) { this.warn(`Cannot restore earlier child journal: ${error.message}`); }
    for (const file of files) {
      if (signal?.aborted) return;
      try {
        const record = this.read(file);
        if (!hub.get(record.id)) hub.restore({ ...record, messages: undefined });
      } catch (error) { this.warn(`Cannot restore ${path.basename(file)}: ${error.message}`); }
      // Large saved sessions must not monopolize the input loop.
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  load(record) { return record.messages ?? this.read(record.file).messages; }
  saveDraft(record, text) {
    if (!record.file) return;
    const manager = record.session?.sessionManager ?? this.open(record.file);
    manager.appendCustomEntry(DRAFT_ENTRY, { text });
  }
  saveMetadata(record) {
    if (!record.file) return;
    const manager = record.session?.sessionManager ?? this.open(record.file);
    const { id, label, role, model, thinking, metadata, startedAt, endedAt, state, stats, context, outcome, deliveries } = record;
    manager.appendCustomEntry(WORKER_ENTRY, structuredClone({ id, label, role, model, thinking, metadata, startedAt, endedAt, state, stats, context, outcome, deliveries }));
  }
}
