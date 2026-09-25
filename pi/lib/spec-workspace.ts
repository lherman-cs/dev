import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import type { ReviewMessage } from "./review-workspace.ts";
import type { Attention } from "./attention.ts";

export type SpecSection = { id: string; title: string; kind: "motivation" | "requirement" | "question" | "scope" | "evidence"; body: string };
export type SpecDecision = Attention & { id: string; subject: string; recommendation: string; consequence: string; status: "open" | "accepted"; version: string };
export type SpecDocument = { version: string; digest: string; sections: SpecSection[]; decisions: SpecDecision[]; recommendation: string; markdown: string; at: number };
export type SpecState = { schema: 1; current?: SpecDocument; pending?: SpecDocument; updates: SpecDocument[]; discussions: ReviewMessage[]; drafts: Record<string, string>; selection: string; needsSync?: boolean; changeRequest?: { version: string; id: string; at: number }; approval?: { digest: string; version: string; at: number }; recovered: boolean; notice?: string };
const empty = (): SpecState => ({ schema: 1, updates: [], discussions: [], drafts: {}, selection: "general", recovered: false });
// Approval status is metadata, not part of the semantic target, even when the
// starting Markdown had no status line and approval adds one.
export const semantic = (text: string) => text.replace(/^Status:[^\r\n]*\r?\n(?:\r?\n)?/, "");
const digest = (text: string) => createHash("sha256").update(semantic(text)).digest("hex");
export class SpecWorkspace {
  state: SpecState = empty();
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  readonly path: string;
  readonly file: string;
  readonly cwd: string;
  constructor(path: string, file: string, cwd: string) {
    this.path = path; this.file = file; this.cwd = cwd;
    if (relative(resolve(cwd), resolve(path)).startsWith("..")) throw new Error("Spec must be within the project");
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private changed() { for (const fn of this.listeners) fn(); }
  async restore() {
    try {
      const saved: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!saved || typeof saved !== "object" || (saved as SpecState).schema !== 1 || !Array.isArray((saved as SpecState).discussions) || !(saved as SpecState).drafts) throw new Error("Invalid spec workspace format");
      this.state = { ...saved as SpecState, updates: Array.isArray((saved as SpecState).updates) ? (saved as SpecState).updates : [], recovered: true,
        notice: "Restored spec discussion. Agent reconciliation is required before approval." };
      delete this.state.approval;
      for (const m of this.state.discussions) if (m.status === "queued") m.status = "failed";
    } catch (error) {
      this.state = empty();
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.state.notice = `Saved spec workspace unreadable: ${String(error)}. Prior decisions and drafts cannot be assumed.`;
    }
    this.changed();
  }
  persist() {
    const text = JSON.stringify(this.state);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try { await writeFile(temp, text, { mode: 0o600 }); await rename(temp, this.file); }
      catch (error) { this.state.notice = `Spec workspace not saved: ${String(error)}`; this.changed(); throw error; }
    });
    this.changed(); return this.writes;
  }
  async publish(input: { sections: SpecSection[]; decisions: Omit<SpecDecision, "status" | "version">[]; recommendation: string; markdown: string }) {
    if (!input.sections.some(s => s.kind === "motivation") || !input.recommendation.trim() || !input.markdown.trim()) throw new Error("Spec needs motivation, recommendation and Markdown.");
    const actual = await readFile(this.path, "utf8").catch(() => "");
    if (semantic(actual) !== semantic(input.markdown)) throw new Error("Publish the exact Markdown saved at the spec path first.");
    const version = randomUUID();
    const doc: SpecDocument = { ...input, digest: digest(actual), version, at: Date.now(), decisions: input.decisions.map(d => ({ ...d, version, status: "open" as const })) };
    if (this.state.current) { if (this.state.pending) this.state.updates.push(doc); else this.state.pending = doc; }
    else { this.state.current = doc; this.state.selection = input.sections[0]?.id || "general"; }
    this.state.recovered = false; this.state.needsSync = false; delete this.state.approval;
    if (this.state.pending) this.state.notice = "New spec revision available to inspect and apply. Approval is suspended.";
    else delete this.state.notice;
    await this.persist(); return doc;
  }
  async applyUpdate() {
    if (!this.state.pending) return;
    this.state.current = this.state.pending;
    const following = this.state.updates.shift();
    if (following) this.state.pending = following; else delete this.state.pending;
    delete this.state.approval;
    this.state.notice = "Spec revision applied. Earlier discussions belong to their original revision; decisions require renewed review.";
    await this.persist();
  }
  async check() {
    const actual = await readFile(this.path, "utf8").catch(() => "");
    const current = this.state.current;
    const reason = !current ? "No spec revision published" : this.state.recovered ? "Restored spec awaits agent reconciliation" :
      this.state.pending ? "A newer revision awaits inspection" : digest(actual) !== current.digest ? "Spec file changed outside the assessment" :
      this.state.changeRequest?.version === current.version ? "Changes requested; await updated spec" :
      this.state.needsSync ? "Accepted decision awaits inclusion in the durable spec and publication" :
      current.decisions.some(d => d.status === "open") ? "Resolve consequential decisions" : "Current spec";
    return { current: reason === "Current spec", reason, digest: digest(actual) };
  }
  async decide(id: string, expectedVersion?: string) {
    const check = await this.check();
    if (!["Current spec", "Resolve consequential decisions"].includes(check.reason) || (expectedVersion && this.state.current?.version !== expectedVersion)) throw new Error(`${check.reason}. Displayed revision may be stale.`);
    const d = this.state.current?.decisions.find(d => d.id === id && d.status === "open");
    if (!d) throw new Error("Decision not open on displayed revision");
    d.status = "accepted"; this.state.needsSync = true; delete this.state.approval; await this.persist();
  }
  async approve(expectedVersion?: string) {
    const check = await this.check(); if (!check.current || !this.state.current || (expectedVersion && this.state.current.version !== expectedVersion)) throw new Error(`Approval unavailable: ${check.reason}. Displayed revision may be stale.`);
    const version = this.state.current.version;
    if (this.state.discussions.some(m => m.author === "human" && m.status === "queued" && m.version === version)) throw new Error("Wait for the agent's answer before approval.");
    const actual = await readFile(this.path, "utf8");
    if (digest(actual) !== check.digest || this.state.pending || this.state.current?.version !== version) throw new Error("Spec changed during approval");
    // Status recording is not a semantic revision. Recheck immediately before and after writing.
    const marked = /^Status:[^\r\n]*/.test(actual) ? actual.replace(/^Status:[^\r\n]*/, "Status: APPROVED") : `Status: APPROVED\n\n${actual}`;
    if (marked !== actual) await writeFile(this.path, marked);
    if (digest(await readFile(this.path, "utf8")) !== check.digest || this.state.pending || this.state.current?.version !== version) throw new Error("Spec changed during status recording; approval not retained");
    this.state.approval = { digest: check.digest, version, at: Date.now() };
    await this.persist();
  }
  async requestChanges(id: string) {
    const check = await this.check();
    if (!["Current spec", "Resolve consequential decisions"].includes(check.reason) || !this.state.current) throw new Error(`Request unavailable: ${check.reason}`);
    this.state.changeRequest = { version: this.state.current.version, id, at: Date.now() };
    delete this.state.approval;
    await this.persist();
  }
  async addHuman(subject: string, text: string) {
    if (!text.trim()) throw new Error("Write a question or request first");
    const message: ReviewMessage = { id: randomUUID(), subject, version: this.state.current?.version || "unassessed", author: "human", text, status: "queued" };
    this.state.discussions.push(message);
    if (message.version === this.state.current?.version) delete this.state.approval;
    await this.persist(); return message;
  }
  async fail(id: string, reason: string) {
    const m = this.state.discussions.find(m => m.id === id && m.status === "queued");
    if (m) { m.status = "failed"; if (this.state.changeRequest?.id === id) delete this.state.changeRequest; this.state.notice = `Not delivered: ${reason}. No automatic retry.`; await this.persist(); }
  }
  async answer(id: string, text: string) {
    const m = this.state.discussions.find(m => m.id === id && m.author === "human" && m.status === "queued");
    if (!m) throw new Error("Request not pending");
    m.status = "answered";
    this.state.discussions.push({ id: randomUUID(), subject: m.subject, version: m.version, author: "agent", text });
    await this.persist();
  }
}
