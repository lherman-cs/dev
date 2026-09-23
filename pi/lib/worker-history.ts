import fs from "node:fs";
import path from "node:path";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PersistedWorker, WorkerContextUsage, WorkerDelivery, WorkerHistoryStore, WorkerMessage, WorkerRecord, WorkerState } from "./worker-types.ts";

export const WORKER_ENTRY = "dev-worker-v1";
export const DRAFT_ENTRY = "dev-worker-draft-v1";
const terminal = new Set<WorkerState>(["completed", "failed", "aborted", "interrupted"]);

type ParentSession = Pick<SessionManager, "getSessionFile" | "getSessionId" | "getSessionDir" | "getLeafId" | "getHeader" | "getEntries" | "setSessionFile" | "branch" | "getCwd">;
type WorkerMetadata = Omit<PersistedWorker, "messages" | "draft" | "closed" | "unread" | "version" | "partial" | "context" | "file"> & {
  draft?: string;
  sessionFile?: string;
  receipts?: LegacyReceipt[];
  context?: WorkerContextUsage;
  file?: string;
};
interface DraftData { text: string }
interface LegacyReceipt { text: string; state: string; at?: number; createdAt?: number }

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const customData = (entry: SessionEntry, customType: string): unknown => entry.type === "custom" && entry.customType === customType ? entry.data : undefined;
const asMetadata = (value: unknown): WorkerMetadata | undefined => isObject(value) && typeof value["id"] === "string" ? value as unknown as WorkerMetadata : undefined;
const asDraft = (value: unknown): DraftData | undefined => isObject(value) && typeof value["text"] === "string" ? { text: value["text"] } : undefined;

/** Native Pi JSONL is the only transcript store. No separate index/database. */
export class WorkerHistory implements WorkerHistoryStore {
  parent: ParentSession;
  warn: (message: string) => void;
  root: string | undefined;
  legacyRoot: string | undefined;
  legacy: Map<string, WorkerMetadata>;

  constructor(parent: ParentSession, warn: (message: string) => void = () => undefined) {
    this.parent = parent;
    this.warn = warn;
    const file = parent.getSessionFile();
    this.root = file ? `${file}.workers` : undefined;
    const id = parent.getSessionId(), dir = parent.getSessionDir();
    this.legacyRoot = dir && /^[a-zA-Z0-9_-]+$/.test(id) ? path.join(dir, ".workers", id) : undefined;
    this.legacy = new Map();
  }

  ensureParent(): void {
    const file = this.parent.getSessionFile();
    if (!file || fs.existsSync(file)) return;
    // Pi defers new files until an assistant speaks. Controller-only Main
    // sessions may never do so. Use the public native SessionManager reload
    // operation after an exact snapshot, preserving id, entries and active leaf.
    if (!(this.parent instanceof SessionManager)) throw new Error("Early session persistence requires the pinned native SessionManager.");
    const leaf = this.parent.getLeafId();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, [this.parent.getHeader(), ...this.parent.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    this.parent.setSessionFile(file);
    if (leaf && leaf !== this.parent.getLeafId()) this.parent.branch(leaf);
  }

  create(cwd: string, metadata: Record<string, unknown>): SessionManager {
    this.ensureParent();
    if (!this.root) return SessionManager.inMemory(cwd);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const parentSession = this.parent.getSessionFile();
    const created = SessionManager.create(cwd, this.root, parentSession ? { parentSession } : {});
    const file = created.getSessionFile();
    if (!file) throw new Error("Native worker session did not provide a session file.");
    fs.writeFileSync(file, `${JSON.stringify(created.getHeader())}\n`, { flag: "wx", mode: 0o600 });
    const manager = SessionManager.open(file, this.root, cwd);
    manager.appendCustomEntry(WORKER_ENTRY, { ...metadata, state: "starting" });
    return manager;
  }

  open(file: string): SessionManager {
    if (!this.root || !file) throw new Error("This thread has no saved Pi session.");
    const roots = [this.root, this.legacyRoot]
      .filter((root): root is string => typeof root === "string" && fs.existsSync(root))
      .map(root => fs.realpathSync(root));
    const realFile = fs.realpathSync(file);
    if (!roots.includes(path.dirname(realFile)) || !realFile.endsWith(".jsonl")) throw new Error("Child transcript is outside this parent session.");
    const manager = SessionManager.open(realFile, path.dirname(realFile));
    if (path.resolve(manager.getCwd()) !== path.resolve(this.parent.getCwd())) {
      const metadata = [...manager.getEntries()].reverse().map(entry => customData(entry, WORKER_ENTRY)).map(asMetadata).find((value): value is WorkerMetadata => value !== undefined);
      const origin = metadata?.metadata;
      if (origin?.["readOnly"] !== true || typeof origin["ownerCwd"] !== "string" || typeof origin["snapshotCwd"] !== "string"
        || path.resolve(origin["ownerCwd"]) !== path.resolve(this.parent.getCwd())
        || path.resolve(origin["snapshotCwd"]) !== path.resolve(manager.getCwd())) {
        throw new Error("Child transcript belongs to another worktree.");
      }
    }
    return manager;
  }

  read(file: string): PersistedWorker {
    const entries = this.open(file).getEntries();
    const metadata = [...entries].reverse().map(entry => customData(entry, WORKER_ENTRY)).map(asMetadata).find((value): value is WorkerMetadata => value !== undefined) ?? this.legacy.get(file);
    if (!metadata) throw new Error("Child session has no worker metadata.");
    const draft = [...entries].reverse().map(entry => customData(entry, DRAFT_ENTRY)).map(asDraft).find((value): value is DraftData => value !== undefined);
    const deliveries: WorkerDelivery[] = (metadata.deliveries ?? []).map(delivery => ["sending", "queued"].includes(delivery.status)
      ? { ...delivery, status: "failed", error: "Session interrupted before confirmed delivery. Restore this message from Actions." }
      : delivery);
    const state: WorkerState = terminal.has(metadata.state) ? metadata.state : "interrupted";
    const messages = entries.flatMap(entry => entry.type === "message" && entry.message.role !== "system" ? [entry.message as unknown as WorkerMessage] : []);
    return {
      ...metadata,
      file,
      endedAt: metadata.endedAt ?? fs.statSync(file).mtimeMs,
      deliveries,
      state,
      activity: terminal.has(metadata.state) ? metadata.state : "Interrupted before completion",
      messages,
      draft: draft?.text ?? metadata.draft ?? "",
      closed: true,
      unread: false,
      version: 0,
      partial: undefined,
      context: metadata.context,
    };
  }

  legacyFiles(): string[] {
    const file = this.legacyRoot && path.join(this.legacyRoot, "hub-state.jsonl");
    if (!file || !fs.existsSync(file)) return [];
    const records = new Map<string, WorkerMetadata>();
    const drafts = new Map<string, string>();
    for (const entry of this.open(file).getEntries()) {
      if (entry.type !== "custom") continue;
      const data = asMetadata(entry.data);
      if (entry.customType === "dev-worker" && data) records.set(data.id, data);
      if (entry.customType === "dev-draft" && isObject(entry.data) && typeof entry.data["id"] === "string" && typeof entry.data["text"] === "string") drafts.set(entry.data["id"], entry.data["text"]);
    }
    for (const data of records.values()) {
      if (!data.sessionFile) continue;
      const deliveries: WorkerDelivery[] = (data.receipts ?? []).map(receipt => ({
        id: crypto.randomUUID(), text: receipt.text, mode: "steer", status: receipt.state === "undelivered" ? "failed" : "delivered", at: receipt.at ?? receipt.createdAt ?? 0,
      }));
      this.legacy.set(data.sessionFile, { ...data, file: data.sessionFile, draft: drafts.get(data.id) ?? "", deliveries });
    }
    return [...this.legacy.keys()];
  }

  async restore(hub: { get(id: string): unknown; restore(record: PersistedWorker): void }, signal?: AbortSignal): Promise<void> {
    if (!this.root) return;
    const files = fs.existsSync(this.root) ? fs.readdirSync(this.root).filter(name => name.endsWith(".jsonl")).sort().map(name => path.join(this.root as string, name)) : [];
    try { files.push(...this.legacyFiles()); } catch (error) { this.warn(`Cannot restore earlier child journal: ${messageOf(error)}`); }
    for (const file of files) {
      if (signal?.aborted) return;
      try {
        const record = this.read(file);
        if (!hub.get(record.id)) hub.restore({ ...record, messages: undefined });
      } catch (error) { this.warn(`Cannot restore ${path.basename(file)}: ${messageOf(error)}`); }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  load(record: WorkerRecord): WorkerMessage[] { return record.messages ?? this.read(record.file ?? "").messages ?? []; }
  saveDraft(record: WorkerRecord, text: string): void {
    if (!record.file) return;
    const manager = record.session?.sessionManager ?? this.open(record.file);
    manager.appendCustomEntry(DRAFT_ENTRY, { text });
  }
  saveMetadata(record: WorkerRecord): void {
    if (!record.file) return;
    const manager = record.session?.sessionManager ?? this.open(record.file);
    const { id, label, role, model, thinking, metadata, startedAt, endedAt, state, stats, context, outcome, deliveries } = record;
    manager.appendCustomEntry(WORKER_ENTRY, structuredClone({ id, label, role, model, thinking, metadata, startedAt, endedAt, state, stats, context, outcome, deliveries }));
  }
}
