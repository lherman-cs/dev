import type { CandidateIdentity, CiCheck, WaitOutcome } from "./ship-contracts.ts";

export interface Clock { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void>; }
export const systemClock: Clock = { now: () => Date.now(), sleep: (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms); const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
  signal?.addEventListener("abort", abort, { once: true });
}) };
export interface CiPollConfig { initialDelayMs: number; maxDelayMs: number; timeoutMs: number; }
export interface CiPollDependencies { observe(candidate: CandidateIdentity): Promise<CiCheck[]>; persistObservation(candidate: CandidateIdentity, checks: CiCheck[]): void | Promise<void>; persist(outcome: WaitOutcome): void | Promise<void>; clock?: Clock; }
const complete = (check: CiCheck) => check.state === "COMPLETED" || check.state === "completed";
const successful = (check: CiCheck) => check.conclusion === "SUCCESS" || check.conclusion === "success" || check.conclusion === "NEUTRAL" || check.conclusion === "neutral" || check.conclusion === "SKIPPED" || check.conclusion === "skipped";
/** Polls only the exact candidate head. Each observation is persisted before waiting again. */
export async function waitForCi(candidate: CandidateIdentity, requiredIds: readonly string[], deps: CiPollDependencies, config: CiPollConfig, signal?: AbortSignal): Promise<WaitOutcome> {
  const clock = deps.clock ?? systemClock, started = clock.now(); let delay = config.initialDelayMs, latest: CiCheck[] = [];
  const finish = async (status: WaitOutcome["status"]): Promise<WaitOutcome> => { const result: WaitOutcome = { status, candidate, checks: latest }; await deps.persist(result); return result; };
  try {
    for (;;) {
      if (signal?.aborted) return finish("cancelled");
      latest = await deps.observe(candidate);
      if (latest.some(check => check.head !== candidate.branch.head)) return finish("interrupted");
      const required = latest.filter(check => requiredIds.includes(check.id));
      if (required.length !== requiredIds.length || new Set(required.map(check => check.id)).size !== requiredIds.length) return finish("interrupted");
      if (required.every(complete)) return finish(required.every(successful) ? "passed" : "failed");
      if (clock.now() - started >= config.timeoutMs) return finish("stale_timeout");
      await deps.persistObservation(candidate, latest);
      await clock.sleep(delay, signal); delay = Math.min(config.maxDelayMs, Math.max(delay + 1, delay * 2));
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return finish("cancelled");
    return finish("interrupted");
  }
}
