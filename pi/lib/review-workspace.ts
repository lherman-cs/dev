import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

const exec = promisify(execFile);
export type ReviewSection = { id: string; title: string; kind: "outcome" | "design" | "evidence" | "risk" | "system" | "code"; body: string };
export type ReviewDecision = { id: string; subject: string; recommendation: string; consequence: string; kind: "choice" | "risk"; status: "open" | "accepted" | "waived"; version: string };
export type ReviewMessage = { id: string; subject: string; version: string; author: "human" | "agent"; text: string; status?: "queued" | "answered" | "failed" };
export type ReviewCandidate = { head: string; main: string; clean: boolean; fingerprint: string };
export type ReviewAssessment = { version: string; candidate: ReviewCandidate; sections: ReviewSection[]; decisions: ReviewDecision[]; recommendation: string; at: number };
export type ReviewState = { schema: 1; current?: ReviewAssessment; pending?: ReviewAssessment; updates: ReviewAssessment[]; discussions: ReviewMessage[]; drafts: Record<string, string>; selection: string; scroll: Record<string, number>; approval?: { fingerprint: string; version: string; at: number }; notice?: string; recovered: boolean };
const initial = (): ReviewState => ({ schema: 1, updates: [], discussions: [], drafts: {}, selection: "outcome", scroll: {}, recovered: false });
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const git = async (cwd: string, ...args: string[]) => (await exec("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 })).stdout.trim();
/** A dirty candidate is visible but never approvable. HEAD and local main identify clean candidates. */
export async function reviewCandidate(cwd: string): Promise<ReviewCandidate> {
  const [head, status, main] = await Promise.all([
    git(cwd, "rev-parse", "HEAD"), git(cwd, "status", "--porcelain=v1", "--untracked-files=all"),
    git(cwd, "rev-parse", "main").catch(() => "unavailable"),
  ]);
  const clean = !status;
  return { head, main, clean, fingerprint: sha(`${head}\0${main}\0${status}`) };
}
const valid = (s: unknown): s is ReviewState => !!s && typeof s === "object" && (s as ReviewState).schema === 1 &&
  Array.isArray((s as ReviewState).discussions) && !!(s as ReviewState).drafts && typeof (s as ReviewState).selection === "string" &&
  !!(s as ReviewState).scroll && typeof (s as ReviewState).scroll === "object";
export class ReviewWorkspace {
  state: ReviewState = initial();
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  readonly cwd: string;
  readonly file: string;
  constructor(cwd: string, file: string) { this.cwd = cwd; this.file = file; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed() { for (const listener of this.listeners) listener(); }
  async restore() {
    try {
      const saved: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!valid(saved)) throw new Error("Invalid review state format");
      this.state = { ...saved, updates: Array.isArray(saved.updates) ? saved.updates : [], recovered: true,
        notice: "Restored review. Approval is historical; the agent must reassess this candidate before approval is available." };
      delete this.state.approval;
      // Any unacknowledged transmission remains uncertain, never silently replayed.
      for (const message of this.state.discussions) if (message.status === "queued") message.status = "failed";
    } catch (error) {
      this.state = initial();
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.state.notice = "Saved review could not be read. Prior decisions and drafts cannot be assumed: " + String(error);
    }
    this.changed();
  }
  persist() {
    const text = JSON.stringify(this.state);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temp = join(dirname(this.file), `.review-${randomUUID()}.tmp`);
      try { await writeFile(temp, text, { mode: 0o600 }); await rename(temp, this.file); }
      catch (error) { this.state.notice = `Review not saved: ${String(error)}`; this.changed(); throw error; }
    });
    this.changed();
    return this.writes;
  }
  async publish(input: { sections: ReviewSection[]; decisions: Omit<ReviewDecision, "version" | "status">[]; recommendation: string }) {
    if (!input.sections.some(s => s.kind === "outcome") || !input.sections.some(s => s.kind === "evidence") || !input.recommendation.trim()) throw new Error("Assessment requires outcome, evidence and recommendation.");
    const candidate = await reviewCandidate(this.cwd);
    const version = randomUUID();
    const assessment: ReviewAssessment = { ...input, version, candidate, at: Date.now(),
      decisions: input.decisions.map(d => ({ ...d, status: "open" as const, version })) };
    if (this.state.current) {
      // Preserve the material being read, including an update under inspection.
      if (this.state.pending) this.state.updates.push(assessment);
      else this.state.pending = assessment;
      this.state.notice = `New assessment available${this.state.updates.length ? ` (${this.state.updates.length} more queued)` : ""}. Preview and apply in order; your reading position and drafts are retained.`;
    } else { this.state.current = assessment; this.state.selection = input.sections[0]?.id || "outcome"; }
    this.state.recovered = false; delete this.state.approval;
    await this.persist();
    return assessment;
  }
  async applyUpdate() {
    if (!this.state.pending) return;
    this.state.current = this.state.pending;
    const following = this.state.updates.shift();
    if (following) this.state.pending = following;
    else delete this.state.pending;
    delete this.state.approval;
    this.state.notice = "Assessment updated. Earlier discussion belongs to its original version; affected decisions require a new review.";
    await this.persist();
  }
  async check(): Promise<{ candidate: ReviewCandidate; current: boolean; reason: string }> {
    const candidate = await reviewCandidate(this.cwd);
    const current = this.state.current;
    const match = !!current && !this.state.recovered && !this.state.pending && candidate.clean && current.candidate.clean &&
      candidate.fingerprint === current.candidate.fingerprint;
    return { candidate, current: match, reason: !current ? "No assessment has been published" : this.state.recovered ? "Restored assessment awaits agent reconciliation" :
      this.state.pending ? "A newer assessment awaits inspection" : !candidate.clean ? "Candidate has uncommitted changes" :
      current.candidate.fingerprint !== candidate.fingerprint ? "Candidate or integration baseline changed" : "Current candidate" };
  }
  async approve() {
    const before = await this.check();
    if (!before.current || !this.state.current) throw new Error(`Approval unavailable: ${before.reason}`);
    if (this.state.current.decisions.some(d => d.status === "open")) throw new Error("Resolve consequential decisions before approval.");
    const after = await reviewCandidate(this.cwd);
    if (!after.clean || after.fingerprint !== before.candidate.fingerprint) throw new Error("Candidate changed during approval. Reassess it first.");
    this.state.approval = { fingerprint: after.fingerprint, version: this.state.current.version, at: Date.now() };
    await this.persist();
  }
  async decide(id: string, status: "accepted" | "waived") {
    const check = await this.check();
    if (!check.current) throw new Error(`Decision unavailable: ${check.reason}`);
    const decision = this.state.current?.decisions.find(d => d.id === id);
    if (!decision || decision.status !== "open") throw new Error("Decision is not open on this assessment.");
    if (status === "waived" && decision.kind !== "risk") throw new Error("Only disclosed risks can be waived; choose a direction for a design decision.");
    decision.status = status; delete this.state.approval;
    await this.persist();
  }
  async addHuman(subject: string, text: string) {
    if (!text.trim()) throw new Error("Write a question or request first.");
    const message: ReviewMessage = { id: randomUUID(), subject, version: this.state.current?.version || "unassessed", author: "human", text, status: "queued" };
    this.state.discussions.push(message); await this.persist(); return message;
  }
  async fail(id: string, reason: string) {
    const message = this.state.discussions.find(m => m.id === id);
    if (message) {
      message.status = "failed";
      const current = message.version === this.state.current?.version;
      if (current && !this.state.drafts[message.subject]) this.state.drafts[message.subject] = message.text;
      this.state.notice = current ? `Not delivered; draft restored. Reason: ${reason}. No automatic retry.` :
        `Not delivered; request remains in its earlier assessment. Reason: ${reason}. No automatic retry.`;
      await this.persist();
    }
  }
  async answer(id: string, text: string) {
    const message = this.state.discussions.find(m => m.id === id && m.author === "human" && m.status === "queued");
    if (!message) throw new Error("Review request is not pending");
    message.status = "answered";
    this.state.discussions.push({ id: randomUUID(), subject: message.subject, version: message.version, author: "agent", text });
    await this.persist();
  }
}
