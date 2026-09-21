import { setTimeout as delay } from "node:timers/promises";

/** One controller-owned latch, not a second workflow state machine. */
export class WorkflowControl {
  constructor({ onChange = () => {}, snapshot = async () => "" } = {}) {
    this.abortController = new AbortController();
    this.onChange = onChange; this.snapshot = snapshot;
    this.state = "running"; this.detail = "Starting"; this.operations = [];
    this.pauseRequested = false; this.paused = false; this.waiter = null;
  }
  get signal() { return this.abortController.signal; }
  publish() { try { this.onChange(this); } catch { /* Presentation must not alter control flow. */ } }
  report(detail) { this.detail = detail; this.publish(); }
  pause() {
    if (this.signal.aborted) return;
    this.pauseRequested = true; this.state = "pause requested"; this.publish();
  }
  async checkpoint(detail = this.detail) {
    this.signal.throwIfAborted(); this.detail = detail;
    if (!this.pauseRequested) { this.publish(); return; }
    if (this.waiter) { await this.waiter.promise; this.signal.throwIfAborted(); return; }
    const fingerprint = await this.snapshot();
    this.signal.throwIfAborted();
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.waiter = { promise, resolve, reject, fingerprint };
    this.paused = true; this.state = "paused"; this.publish();
    try { await promise; this.signal.throwIfAborted(); }
    finally { this.waiter = null; this.paused = false; }
  }
  async resume() {
    const waiter = this.waiter;
    if (!waiter || !this.paused) return false;
    try {
      if (await this.snapshot() !== waiter.fingerprint) throw new Error("Worktree or approved artifacts changed while paused. Stop and reconcile before restarting the workflow; old evidence is not reusable.");
      this.signal.throwIfAborted();
      this.pauseRequested = false; this.state = "running";
      waiter.resolve(); this.publish(); return true;
    } catch (error) { this.stop(error); throw error; }
  }
  stop(reason = new Error("Workflow stopped by human. Existing changes and checkpoints are preserved.")) {
    if (this.signal.aborted) return;
    this.abortController.abort(reason); this.state = "stopping";
    this.waiter?.reject(reason); this.publish();
  }
  async sleep(ms) { await this.checkpoint(); await delay(ms, undefined, { signal: this.signal }); }
  async operation(program, args, execute) {
    await this.checkpoint(`$ ${program} ${args.join(" ")}`);
    const operation = { program, args, startedAt: Date.now(), state: "running" };
    this.operations.push(operation);
    if (this.operations.length > 50) this.operations.shift();
    this.publish();
    try {
      const result = await execute();
      Object.assign(operation, { state: result.code === 0 ? "passed" : "failed", code: result.code, stdout: result.stdout, stderr: result.stderr });
      return result;
    } catch (error) { Object.assign(operation, { state: this.signal.aborted ? "cancelled" : "failed", stderr: error.message }); throw error; }
    finally { operation.endedAt = Date.now(); this.publish(); }
  }
  finish(state, detail) { this.state = state; this.detail = detail || this.detail; this.publish(); }
}
