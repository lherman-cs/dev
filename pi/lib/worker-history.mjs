import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// Pi 0.86 delays a new file until the first assistant response. Seed only its
// native header, then open it through the public API so pre-response failures,
// receipts and drafts persist too. No fabricated assistant turn or second format.
export function nativeSessionFile(cwd, file, parentSession) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) {
    const seed = SessionManager.inMemory(cwd, { parentSession });
    fs.writeFileSync(file, JSON.stringify(seed.getHeader()) + "\n", { flag: "wx", mode: 0o600 });
  }
  return SessionManager.open(file);
}

function worktree(cwd) {
  let current = fs.realpathSync(cwd);
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return fs.realpathSync(cwd);
    current = parent;
  }
}

export class WorkerHistory {
  constructor({ cwd, sessionId, sessionDir, parentFile }) {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Invalid parent session identity.");
    this.cwd = path.resolve(cwd);
    this.worktree = worktree(cwd);
    this.root = path.join(sessionDir, ".workers");
    this.directory = path.join(this.root, sessionId);
    this.parentFile = parentFile;
    this.sessionId = sessionId;
    this.journal = nativeSessionFile(this.cwd, path.join(this.directory, "hub-state.jsonl"), parentFile);
    this.last = new Map();
  }

  createSession(cwd) {
    if (worktree(cwd) !== this.worktree) throw new Error("Child session is outside the parent's worktree.");
    return nativeSessionFile(cwd, path.join(this.directory, `${randomUUID()}.jsonl`), this.parentFile);
  }

  record(record) {
    const data = {};
    for (const key of ["id", "label", "role", "model", "thinking", "metadata", "sessionFile", "state", "activity", "outcome", "error", "startedAt", "updatedAt", "endedAt", "stats", "context"]) {
      if (record[key] !== undefined) data[key] = record[key];
    }
    data.rootSessionId = this.sessionId;
    data.receipts = record.receipts.map(({ wireText, ...receipt }) => receipt);
    const encoded = JSON.stringify(data);
    if (this.last.get(record.id) !== encoded) {
      this.journal.appendCustomEntry("dev-worker", data);
      this.last.set(record.id, encoded);
    }
  }

  records() {
    const records = new Map();
    for (const entry of this.journal.getEntries()) {
      if (entry.type === "custom" && entry.customType === "dev-worker" && entry.data?.id) records.set(entry.data.id, entry.data);
    }
    return [...records.values()];
  }

  drafts() {
    const drafts = new Map();
    for (const entry of this.journal.getEntries()) {
      if (entry.type === "custom" && entry.customType === "dev-draft" && entry.data?.id) drafts.set(entry.data.id, entry.data);
    }
    return drafts;
  }

  saveDraft(id, text) { this.journal.appendCustomEntry("dev-draft", { id, text }); }

  canLoad(record) {
    if (!record.sessionFile) return false;
    try { return fs.realpathSync(record.sessionFile).startsWith(fs.realpathSync(this.root) + path.sep); }
    catch { return false; }
  }

  async load(record) {
    if (!record.sessionFile) throw new Error("This producer did not retain a native transcript.");
    const root = fs.realpathSync(this.root);
    const file = fs.realpathSync(record.sessionFile);
    if (!file.startsWith(root + path.sep) || !file.endsWith(".jsonl")) throw new Error("Transcript is outside this parent's worker storage.");
    const session = SessionManager.open(file);
    if (worktree(session.getCwd()) !== this.worktree) throw new Error("Transcript belongs to another worktree.");
    // Native entry order is authoritative, even if message timestamps are absent,
    // equal, or the wall clock moved. Compaction does not erase prior evidence.
    return session.getEntries().flatMap(entry => {
      if (entry.type === "message" && entry.message.role !== "system") return [entry.message];
      if (entry.type === "compaction") return [{ role: "custom", content: `Context compacted at ${entry.timestamp}; original messages remain above.`, timestamp: Date.parse(entry.timestamp) }];
      return [];
    });
  }

  previous() {
    const result = [];
    for (const dir of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === this.sessionId) continue;
      const file = path.join(this.root, dir.name, "hub-state.jsonl");
      if (!fs.existsSync(file)) continue;
      try {
        const journal = SessionManager.open(file);
        if (worktree(journal.getCwd()) !== this.worktree) continue;
        const records = new Map();
        for (const entry of journal.getEntries()) {
          if (entry.type === "custom" && entry.customType === "dev-worker" && entry.data?.id) records.set(entry.data.id, entry.data);
        }
        result.push(...records.values());
      } catch { /* A damaged older session must not prevent opening the current one. */ }
    }
    return result;
  }
}
