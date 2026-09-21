import fs from "node:fs";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { WorkerMessage, WorkerRecord } from "./worker-hub.ts";

export const WORKER_ENTRY = "dev-worker-v1";
export const DRAFT_ENTRY = "dev-worker-draft-v1";
const terminal = new Set(["completed", "failed", "aborted", "interrupted"]);
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
type Persisted = Record<string, any>;

/** Native Pi JSONL is the only transcript store. No separate index/database. */
export class WorkerHistory {
  readonly parent: SessionManager;
  readonly warn: (message: string) => void;
  readonly root?: string;
  readonly legacyRoot?: string;
  readonly legacy = new Map<string, Persisted>();

  constructor(parent: SessionManager, warn: (message: string) => void = () => {}) {
    this.parent = parent;
    this.warn = warn;
    const file = parent.getSessionFile?.();
    this.root = file ? `${file}.workers` : undefined;
    const id = parent.getSessionId?.(), dir = parent.getSessionDir?.();
    this.legacyRoot = dir && /^[a-zA-Z0-9_-]+$/.test(id || "") ? path.join(dir, ".workers", id) : undefined;
  }

  ensureParent(): void {
    const file = this.parent.getSessionFile?.();
    if (!file || fs.existsSync(file)) return;
    const leaf = this.parent.getLeafId();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, [this.parent.getHeader(), ...this.parent.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    this.parent.setSessionFile(file);
    if (leaf !== this.parent.getLeafId()) this.parent.branch(leaf);
  }

  create(cwd: string, metadata: Persisted): SessionManager {
    this.ensureParent();
    if (!this.root) return SessionManager.inMemory(cwd);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const created = SessionManager.create(cwd, this.root, { parentSession: this.parent.getSessionFile() });
    const file = created.getSessionFile();
    if (!file) throw new Error("Pi did not assign a child session file.");
    fs.writeFileSync(file, `${JSON.stringify(created.getHeader())}\n`, { flag: "wx", mode: 0o600 });
    const manager = SessionManager.open(file, this.root, cwd);
    manager.appendCustomEntry(WORKER_ENTRY, { ...metadata, state: "starting" });
    return manager;
  }

  open(file: string): SessionManager {
    if (!this.root || !file) throw new Error("This thread has no saved Pi session.");
    const roots = [this.root, this.legacyRoot].filter((root): root is string => !!root && fs.existsSync(root)).map(root => fs.realpathSync(root));
    const realFile = fs.realpathSync(file);
    if (!roots.includes(path.dirname(realFile)) || !realFile.endsWith(".jsonl")) throw new Error("Child transcript is outside this parent session.");
    const manager = SessionManager.open(realFile, path.dirname(realFile));
    if (path.resolve(manager.getCwd()) !== path.resolve(this.parent.getCwd())) throw new Error("Child transcript belongs to another worktree.");
    return manager;
  }

  read(file: string): WorkerRecord {
    const manager = this.open(file);
    const entries = manager.getEntries();
    const metadata = ([...entries].reverse().find(entry => entry.type === "custom" && entry.customType === WORKER_ENTRY)?.data || this.legacy.get(file)) as Persisted | undefined;
    if (!metadata || typeof metadata.id !== "string") throw new Error("Child session has no worker metadata.");
    const draftData = ([...entries].reverse().find(entry => entry.type === "custom" && entry.customType === DRAFT_ENTRY)?.data || { text: metadata.draft || "" }) as Persisted;
    const deliveries = Array.isArray(metadata.deliveries) ? metadata.deliveries : [];
    const messages = entries
      .filter(entry => entry.type === "message" && entry.message.role !== "system")
      .map(entry => entry.message as WorkerMessage);
    return {
      id: metadata.id,
      label: typeof metadata.label === "string" ? metadata.label : metadata.id,
      role: typeof metadata.role === "string" ? metadata.role : "worker",
      model: typeof metadata.model === "string" ? metadata.model : undefined,
      thinking: typeof metadata.thinking === "string" ? metadata.thinking : undefined,
      metadata: metadata.metadata && typeof metadata.metadata === "object" ? metadata.metadata : {},
      state: terminal.has(metadata.state) ? metadata.state : "interrupted",
      activity: terminal.has(metadata.state) ? metadata.state : "Interrupted before completion",
      startedAt: typeof metadata.startedAt === "number" ? metadata.startedAt : fs.statSync(file).birthtimeMs,
      updatedAt: typeof metadata.updatedAt === "number" ? metadata.updatedAt : fs.statSync(file).mtimeMs,
      endedAt: typeof metadata.endedAt === "number" ? metadata.endedAt : fs.statSync(file).mtimeMs,
      messages,
      stats: metadata.stats || { input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: null, cost: null, requests: 0, tools: 0 },
      context: metadata.context,
      tools: new Map(),
      deliveries: deliveries.map((delivery: Persisted) => ["sending", "queued"].includes(delivery.status)
        ? { ...delivery, status: "failed", error: "Session interrupted before confirmed delivery. Restore this message from Actions." }
        : delivery),
      draft: typeof draftData.text === "string" ? draftData.text : "",
      version: 0,
      unread: false,
      closed: true,
      file,
      outcome: typeof metadata.outcome === "string" ? metadata.outcome : undefined,
    } as WorkerRecord;
  }

  legacyFiles(): string[] {
    const file = this.legacyRoot && path.join(this.legacyRoot, "hub-state.jsonl");
    if (!file || !fs.existsSync(file)) return [];
    const records = new Map<string, Persisted>(), drafts = new Map<string, string>();
    for (const entry of this.open(file).getEntries()) {
      if (entry.type !== "custom") continue;
      const data = entry.data as Persisted | undefined;
      if (!data || typeof data.id !== "string") continue;
      if (entry.customType === "dev-worker") records.set(data.id, data);
      if (entry.customType === "dev-draft" && typeof data.text === "string") drafts.set(data.id, data.text);
    }
    for (const data of records.values()) {
      if (typeof data.sessionFile !== "string") continue;
      const receipts = Array.isArray(data.receipts) ? data.receipts : [];
      this.legacy.set(data.sessionFile, { ...data, file: data.sessionFile, draft: drafts.get(data.id) || "",
        deliveries: receipts.map((receipt: Persisted) => ({ ...receipt, status: receipt.state === "undelivered" ? "failed" : receipt.state, at: receipt.at || receipt.createdAt })) });
    }
    return [...this.legacy.keys()];
  }

  async restore(hub: { get(id: string): unknown; restore(record: WorkerRecord): void }, signal?: AbortSignal): Promise<void> {
    if (!this.root) return;
    const files = fs.existsSync(this.root) ? fs.readdirSync(this.root).filter(name => name.endsWith(".jsonl")).sort().map(name => path.join(this.root!, name)) : [];
    try { files.push(...this.legacyFiles()); } catch (error: unknown) { this.warn(`Cannot restore earlier child journal: ${errorMessage(error)}`); }
    for (const file of files) {
      if (signal?.aborted) return;
      try {
        const record = this.read(file);
        if (!hub.get(record.id)) hub.restore({ ...record, messages: undefined });
      } catch (error: unknown) { this.warn(`Cannot restore ${path.basename(file)}: ${errorMessage(error)}`); }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  load(record: WorkerRecord): WorkerMessage[] { return record.messages ?? this.read(record.file!).messages ?? []; }
  saveDraft(record: WorkerRecord, text: string): void {
    if (!record.file) return;
    const manager = record.session?.sessionManager as SessionManager | undefined ?? this.open(record.file);
    manager.appendCustomEntry(DRAFT_ENTRY, { text });
  }
  saveMetadata(record: WorkerRecord): void {
    if (!record.file) return;
    const manager = record.session?.sessionManager as SessionManager | undefined ?? this.open(record.file);
    const { id, label, role, model, thinking, metadata, startedAt, endedAt, state, stats, context, outcome, deliveries } = record;
    manager.appendCustomEntry(WORKER_ENTRY, structuredClone({ id, label, role, model, thinking, metadata, startedAt, endedAt, state, stats, context, outcome, deliveries }));
  }
}
