import type { CandidateIdentity, CiCheck, WaitOutcome } from "./ship-contracts.ts";

export interface Clock { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void>; }
export const systemClock: Clock = { now: () => Date.now(), sleep: (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms); const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
  signal?.addEventListener("abort", abort, { once: true });
}) };
export interface CiPollConfig { initialDelayMs: number; maxDelayMs: number; timeoutMs: number; }
export interface CiPollDependencies { observe(candidate: CandidateIdentity): Promise<CiCheck[]>; observeSignals?(candidate: CandidateIdentity): Promise<string[]>; persistObservation(candidate: CandidateIdentity, checks: CiCheck[], signals?: string[]): void | Promise<void>; persist(outcome: WaitOutcome): void | Promise<void>; clock?: Clock; }
const complete = (check: CiCheck) => check.state === "COMPLETED" || check.state === "completed";
const successful = (check: CiCheck) => check.conclusion === "SUCCESS" || check.conclusion === "success" || check.conclusion === "NEUTRAL" || check.conclusion === "neutral" || check.conclusion === "SKIPPED" || check.conclusion === "skipped";
/** Polls only the exact candidate head. Each observation is persisted before waiting again. */
export async function waitForCi(candidate: CandidateIdentity, requiredIds: readonly string[], deps: CiPollDependencies, config: CiPollConfig, signal?: AbortSignal, expectedSignals: readonly string[] = []): Promise<WaitOutcome> {
  const clock = deps.clock ?? systemClock, started = clock.now(); let delay = config.initialDelayMs, latest: CiCheck[] = [], observedSignals: string[] = [];
  const finish = async (status: WaitOutcome["status"], reason?: string): Promise<WaitOutcome> => { const result: WaitOutcome = { status, candidate, checks: latest, ...(expectedSignals.length ? { observedSignals } : {}), ...(reason ? { reason } : {}) }; await deps.persist(result); return result; };
  try {
    for (;;) {
      if (signal?.aborted) return finish("cancelled");
      latest = await deps.observe(candidate);
      observedSignals = deps.observeSignals ? await deps.observeSignals(candidate) : [];
      if (latest.some(check => check.head !== candidate.branch.head)) return finish("interrupted", "candidate_head_changed");
      const required = latest.filter(check => requiredIds.includes(check.id));
      if (required.length !== requiredIds.length || new Set(required.map(check => check.id)).size !== requiredIds.length) return finish("interrupted", "required_check_identity_changed");
      const checksDone = required.every(complete), signalsDone = expectedSignals.every(item => observedSignals.includes(item));
      if (checksDone && required.some(check => !successful(check))) return finish("failed", "required_check_failed");
      if (checksDone && signalsDone) return finish("passed");
      if (clock.now() - started >= config.timeoutMs) return finish("stale_timeout", signalsDone ? "checks_timeout" : "expected_review_signal_timeout");
      await deps.persistObservation(candidate, latest, observedSignals);
      await clock.sleep(delay, signal); delay = Math.min(config.maxDelayMs, Math.max(delay + 1, delay * 2));
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return finish("cancelled");
    return finish("interrupted");
  }
}
