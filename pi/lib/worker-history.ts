import fs from "node:fs";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  DeliveryRecord,
  ParentSessionManager,
  PersistedWorkerRecord,
  WorkerHistoryHub,
  WorkerHistoryRecord,
  WorkerHistorySession,
  WorkerState,
} from "./contracts.js";

export const WORKER_ENTRY = "dev-worker-v1";
export const DRAFT_ENTRY = "dev-worker-draft-v1";
const terminal = new Set<WorkerState>(["completed", "failed", "aborted", "interrupted"]);

type Warn = (message: string) => void;
type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" ? value as UnknownRecord : undefined;
}
function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function state(value: unknown): WorkerState | undefined {
  return typeof value === "string" && ["starting", "working", "aborting", "completed", "failed", "aborted", "interrupted"].includes(value)
    ? value as WorkerState : undefined;
}
function deliveries(value: unknown): DeliveryRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const r = object(item);
    const text = string(r?.text), status = string(r?.status);
    if (!text || !status || !["sending", "queued", "delivered", "failed", "cancelled"].includes(status)) return [];
    return [{ ...r, text, status } as DeliveryRecord];
  });
}

/** Native Pi JSONL is the only transcript store. No separate index/database. */
export class WorkerHistory {
  readonly parent: ParentSessionManager;
  readonly warn: Warn;
  readonly root: string | undefined;
  readonly legacyRoot: string | undefined;
  readonly legacy = new Map<string, PersistedWorkerRecord>();

  constructor(parent: ParentSessionManager, warn: Warn = () => {}) {
    this.parent = parent;
    this.warn = warn;
    const file = parent.getSessionFile();
    this.root = file ? `${file}.workers` : undefined;
    const id = parent.getSessionId(), dir = parent.getSessionDir();
    this.legacyRoot = dir && /^[a-zA-Z0-9_-]+$/.test(id) ? path.join(dir, ".workers", id) : undefined;
  }

  ensureParent(): void {
    const file = this.parent.getSessionFile();
    if (!file || fs.existsSync(file)) return;
    const leaf = this.parent.getLeafId();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, [this.parent.getHeader(), ...this.parent.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n",
      { flag: "wx", mode: 0o600 });
    this.parent.setSessionFile(file);
    if (leaf !== null && leaf !== this.parent.getLeafId()) this.parent.branch(leaf);
  }

  create(cwd: string, metadata: PersistedWorkerRecord): SessionManager {
    this.ensureParent();
    if (!this.root) return SessionManager.inMemory(cwd);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const parentSession = this.parent.getSessionFile();
    const created = SessionManager.create(cwd, this.root, parentSession ? { parentSession } : {});
    const file = created.getSessionFile();
    if (!file) throw new Error("Pi did not allocate a child session file.");
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

  read(file: string): WorkerHistoryRecord & { messages: unknown[]; draft: string } {
    const manager = this.open(file);
    const entries = manager.getEntries();
    const custom = [...entries].reverse().find(entry => entry.type === "custom" && entry.customType === WORKER_ENTRY);
    const customData = custom?.type === "custom" ? object(custom.data) : undefined;
    const metadata = customData ?? this.legacy.get(file);
    const id = string(metadata?.id);
    if (!metadata || !id) throw new Error("Child session has no worker metadata.");
    const draftEntry = [...entries].reverse().find(entry => entry.type === "custom" && entry.customType === DRAFT_ENTRY);
    const draftData = draftEntry?.type === "custom" ? object(draftEntry.data) : undefined;
    const savedState = state(metadata.state);
    const savedDeliveries = deliveries(metadata.deliveries).map(delivery =>
      ["sending", "queued"].includes(delivery.status)
        ? { ...delivery, status: "failed" as const, error: "Session interrupted before confirmed delivery. Restore this message from Actions." }
        : delivery);
    return {
      ...metadata,
      id,
      file,
      endedAt: number(metadata.endedAt) ?? fs.statSync(file).mtimeMs,
      deliveries: savedDeliveries,
      state: savedState && terminal.has(savedState) ? savedState : "interrupted",
      activity: savedState && terminal.has(savedState) ? savedState : "Interrupted before completion",
      messages: entries.flatMap(entry => entry.type === "message" && entry.message.role !== "system" ? [entry.message] : []),
      draft: string(draftData?.text) ?? string(metadata.draft) ?? "",
    } as WorkerHistoryRecord & { messages: unknown[]; draft: string };
  }

  legacyFiles(): string[] {
    const file = this.legacyRoot && path.join(this.legacyRoot, "hub-state.jsonl");
    if (!file || !fs.existsSync(file)) return [];
    const records = new Map<string, UnknownRecord>(), drafts = new Map<string, string>();
    for (const entry of this.open(file).getEntries()) {
      if (entry.type !== "custom") continue;
      const data = object(entry.data), id = string(data?.id);
      if (!id) continue;
      if (entry.customType === "dev-worker") records.set(id, data!);
      if (entry.customType === "dev-draft") drafts.set(id, string(data?.text) ?? "");
    }
    for (const [id, data] of records) {
      const sessionFile = string(data.sessionFile);
      if (!sessionFile) continue;
      const receipts = Array.isArray(data.receipts) ? data.receipts : [];
      this.legacy.set(sessionFile, {
        ...data, id, file: sessionFile, draft: drafts.get(id) ?? "",
        deliveries: receipts.flatMap(item => {
          const r = object(item), text = string(r?.text), rawState = string(r?.state);
          if (!text || !rawState) return [];
          const status = rawState === "undelivered" ? "failed" : rawState;
          return [{ ...r, text, status, at: number(r?.at) ?? number(r?.createdAt) } as DeliveryRecord];
        }),
      } as PersistedWorkerRecord);
    }
    return [...this.legacy.keys()];
  }

  async restore(hub: WorkerHistoryHub, signal?: AbortSignal): Promise<void> {
    if (!this.root) return;
    const files = fs.existsSync(this.root)
      ? fs.readdirSync(this.root).filter(name => name.endsWith(".jsonl")).sort().map(name => path.join(this.root!, name))
      : [];
    try { files.push(...this.legacyFiles()); } catch (error) { this.warn(`Cannot restore earlier child journal: ${error instanceof Error ? error.message : String(error)}`); }
    for (const file of files) {
      if (signal?.aborted) return;
      try {
        const record = this.read(file);
        if (!hub.get(record.id)) { const { messages: _messages, ...metadata } = record; hub.restore(metadata); }
      } catch (error) { this.warn(`Cannot restore ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`); }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  load(record: WorkerHistoryRecord & { messages?: unknown[] }): unknown[] {
    return record.messages ?? this.read(record.file).messages;
  }

  saveDraft(record: WorkerHistoryRecord & { session?: WorkerHistorySession }, text: string): void {
    if (!record.file) return;
    const manager = record.session?.sessionManager ?? this.open(record.file);
    manager.appendCustomEntry(DRAFT_ENTRY, { text });
  }

  saveMetadata(record: WorkerHistoryRecord & { session?: WorkerHistorySession }): void {
    if (!record.file) return;
    const manager = record.session?.sessionManager ?? this.open(record.file);
    const { id, label, role, model, thinking, metadata, startedAt, endedAt, state: workerState, stats, context, outcome, deliveries: workerDeliveries } = record;
    manager.appendCustomEntry(WORKER_ENTRY, structuredClone({
      id, label, role, model, thinking, metadata, startedAt, endedAt, state: workerState, stats, context, outcome, deliveries: workerDeliveries,
    }));
  }
}
