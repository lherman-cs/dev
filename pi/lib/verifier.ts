import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AsyncWorkerCompletion, PublishAsyncWorkerCompletion, TrackAsyncWorkerCompletion } from "./worker.ts";

const parameters = Type.Object({
  commands: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 20 }),
  cwd: Type.Optional(Type.String({ minLength: 1 })),
  prerequisites: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 3_600_000 })),
}, { additionalProperties: false });

type CheckStatus = "passed" | "failed" | "missing_prerequisite" | "cancelled" | "timeout" | "interrupted" | "candidate_drift";
type CheckEvidence = { id: string; status: CheckStatus; candidate: string; cwd: string; commands: string[];
  results: { command: string; exit: number | null; durationMs: number; excerpt: string }[];
  durationMs: number; log: string; detail?: string };

// Include tracked, modified, and untracked non-ignored files. No detached HEAD can certify a dirty candidate.
export function candidateFingerprint(cwd: string): string {
  let root = cwd, revision = "directory", paths: string[];
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
      .toString("utf8").split("\0").filter(Boolean).sort();
  } catch {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      if ([".git", "node_modules"].includes(entry.name)) return [];
      const absolute = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(absolute) : [path.relative(root, absolute)];
    });
    paths = walk(root).sort();
  }
  const hash = createHash("sha256");
  for (const relative of paths) {
    const file = path.join(root, relative);
    hash.update(relative).update("\0");
    try {
      const stat = fs.lstatSync(file);
      hash.update(String(stat.mode & 0o777)).update("\0");
      hash.update(stat.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("<deleted>");
    }
    hash.update("\0");
  }
  return `${revision}:${hash.digest("hex")}`;
}

function executeCommand(command: string, cwd: string, timeoutMs: number, signal: AbortSignal, log: string, onOutput?: (chunk: Buffer) => void): Promise<{ exit: number | null; durationMs: number; excerpt: string; reason?: "cancelled" | "timeout" | "interrupted" }> {
  return new Promise(resolve => {
    const started = performance.now();
    let tail = "", reason: "cancelled" | "timeout" | "interrupted" | undefined, settled = false;
    const output = fs.createWriteStream(log, { flags: "a" });
    const child = spawn("bash", ["-lc", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const collect = (stream: typeof child.stdout) => (chunk: Buffer) => {
      if (!output.destroyed && !output.write(chunk)) { stream.pause(); output.once("drain", () => stream.resume()); }
      tail = (tail + chunk.toString("utf8")).slice(-3000);
      onOutput?.(chunk);
    };
    child.stdout.on("data", collect(child.stdout)); child.stderr.on("data", collect(child.stderr));
    const stop = (why: "cancelled" | "timeout" | "interrupted") => {
      if (settled || reason) return;
      reason = why;
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } }
    };
    output.on("error", error => { tail = (tail + `\nLog error: ${error.message}`).slice(-3000); stop("interrupted"); });
    const abort = () => stop("cancelled");
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    timer.unref();
    child.on("error", error => { reason = reason ?? "interrupted"; tail = (tail + `\nSpawn error: ${error.message}\n`).slice(-3000); });
    child.on("close", code => {
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      const done = () => resolve({ exit: code, durationMs: Math.round(performance.now() - started), excerpt: tail, ...(reason ? { reason } : {}) });
      if (output.destroyed) done(); else output.end(done);
    });
    if (signal.aborted) stop("cancelled");
  });
}

export function createVerifierTool(publish: PublishAsyncWorkerCompletion, options: {
  ownerSessionId?: () => string | undefined; ownerGoal?: () => string; started?: (id: string, owner: string, timeoutMs: number) => void;
  track?: TrackAsyncWorkerCompletion; ownerCwd?: () => string | undefined;
  observe?: (run: { id: string; cwd: string; commands: string[]; record: string; log: string }, cancel: () => void) => {
    command(command: string): void; output(chunk: Buffer): void; finish(status: CheckStatus, outcome: string): void;
  } | undefined;
} = {}): { tool: ToolDefinition<typeof parameters>; cancelAll(): void } {
  const active = new Set<AbortController>();
  const tool: ToolDefinition<typeof parameters> = {
    name: "verify", label: "Verifier",
    description: "Launch specified tests, builds, lints, benchmarks, or acceptance gates asynchronously against the owner's actual candidate. Returns a receipt immediately and delivers evidence later. No repairs or provisioning.",
    promptSnippet: "Route tests, builds, lint checks, benchmarks, and acceptance gates to verify, irrespective of duration or output size",
    promptGuidelines: [
      "Send every test, build, lint check, benchmark, and acceptance gate to verify regardless of expected duration or output size. Explorer investigates; it does not run verification.",
      "Choose exact commands, working directory, candidate, and prerequisites. Do not include source-writing fixes, installs, Git mutations, interactive or privileged operations; handle those with parent Bash.",
      "Verifier runs against the actual owner worktree, including uncommitted files. Keep the tested candidate unchanged until completion; cancel and confirm a run has stopped before repairing. A changed candidate invalidates affected evidence.",
      "A launch receipt is not evidence. Continue independent work while the result is pending; when verification gates progress, yield until its asynchronous completion. Do not poll or rerun just to recover output; use the retained log.",
    ],
    parameters,
    async execute(_callId, args, _signal, _update, ctx) {
      const cwd = path.resolve(options.ownerCwd?.() ?? ctx.cwd, args.cwd ?? ".");
      const id = `verifier:${randomUUID()}`;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-verifier-"));
      const log = path.join(dir, "output.log");
      const record = path.join(dir, "evidence.json");
      const controller = new AbortController(); active.add(controller);
      const ownerGoal = options.ownerGoal?.() ?? "";
      const ownerSessionId = options.ownerSessionId?.();
      // Persist the receipt first: even an interrupted host leaves a non-passing pending record.
      fs.writeFileSync(log, "");
      fs.writeFileSync(record, JSON.stringify({ id, status: "interrupted", cwd, commands: args.commands, log, detail: "No completed evidence was delivered." }));
      const observer = options.observe?.({ id, cwd, commands: args.commands, record, log }, () => controller.abort());
      options.started?.(id, ownerGoal, (args.timeoutMs ?? 600_000) * args.commands.length + 30_000);
      const work = new Promise<void>(resolve => setImmediate(resolve)).then(async (): Promise<CheckEvidence> => {
        const started = performance.now();
        const evidence: CheckEvidence = { id, status: "interrupted", candidate: "unavailable", cwd, commands: args.commands,
          results: [], durationMs: 0, log };
        try {
          evidence.candidate = candidateFingerprint(cwd);
          const missing = (args.prerequisites ?? []).filter(item => !fs.existsSync(path.resolve(cwd, item)));
          if (controller.signal.aborted) evidence.status = "cancelled";
          else if (missing.length) { evidence.status = "missing_prerequisite"; evidence.detail = `Missing: ${missing.join(", ")}`; }
          else for (const command of args.commands) {
            if (controller.signal.aborted) { evidence.status = "cancelled"; break; }
            fs.appendFileSync(log, `\n$ ${command}\n`);
            observer?.command(command);
            const result = await executeCommand(command, cwd, args.timeoutMs ?? 600_000, controller.signal, log, chunk => observer?.output(chunk));
            evidence.results.push({ command, exit: result.exit, durationMs: result.durationMs, excerpt: result.excerpt });
            if (result.reason || result.exit !== 0) { evidence.status = result.reason ?? "failed"; break; }
          }
          if (evidence.status === "interrupted") evidence.status = controller.signal.aborted ? "cancelled" : "passed";
          // A passing exit does not certify a candidate changed during the run.
          if (candidateFingerprint(cwd) !== evidence.candidate) { evidence.detail = "Candidate changed during verification; result cannot certify this candidate."; evidence.status = "candidate_drift"; }
        } catch (error) { evidence.status = controller.signal.aborted ? "cancelled" : "interrupted"; evidence.detail = error instanceof Error ? error.message : String(error); }
        evidence.durationMs = Math.round(performance.now() - started);
        fs.writeFileSync(record, JSON.stringify(evidence, null, 2));
        observer?.finish(evidence.status, `${evidence.status}${evidence.detail ? `: ${evidence.detail}` : ""} · ${evidence.durationMs}ms · record: ${record} · log: ${log}`);
        return evidence;
      });
      const completion = work.then(async evidence => {
        active.delete(controller);
        const compact = { ...evidence, results: evidence.results.map(result => ({ ...result, excerpt: result.exit === 0 ? "" : result.excerpt })) };
        const message: AsyncWorkerCompletion = { id, role: "Verifier", task: args.commands.join(" && "),
          status: evidence.status === "passed" ? "completed" : "failed", result: JSON.stringify(compact), ownerGoal,
          ...(ownerSessionId ? { ownerSessionId } : {}) };
        await publish(message);
      }).catch(() => { active.delete(controller); });
      options.track?.(completion);
      void completion.catch(() => undefined);
      return { content: [{ type: "text" as const, text: `Verifier ${id} started. Candidate evidence pending. Record: ${record}; log: ${log}` }], details: { id, record, log } };
    },
  };
  return { tool, cancelAll: () => { for (const controller of active) controller.abort(); } };
}
