export class WorkflowPaused extends Error {
  constructor() { super("Paused at a safe boundary. Progress is preserved."); this.name = "WorkflowPaused"; }
}

/** Human controls over the existing controller, not another workflow state machine. */
export class WorkflowControl {
  constructor(phase, target, changed = () => {}) {
    this.phase = phase; this.target = target; this.changed = changed;
    this.controller = new AbortController(); this.signal = this.controller.signal;
    this.state = "running"; this.activity = "Starting"; this.pauseRequested = false;
    this.resumeCommand = `/dev-${phase}${target ? ` ${target}` : ""}`;
  }
  publish() { try { this.changed(); } catch { /* UI failure must not change workflow outcome. */ } }
  async capturePause() {
    if (this.snapshot) this.fingerprint = await this.snapshot();
  }
  async verifyResume() {
    if (this.state !== "paused") throw new Error("No safely paused workflow. Reconcile and rerun the original phase command.");
    if (!this.snapshot || !this.fingerprint) throw new Error("No pause evidence available. Reconcile and rerun the original phase command.");
    if (await this.snapshot() !== this.fingerprint) throw new Error("Worktree or approved contracts changed while paused. Reconcile the changes and rerun the phase explicitly; fast continuation was refused.");
  }
  update(activity) { this.activity = activity; this.publish(); }
  checkpoint(activity) {
    this.signal.throwIfAborted();
    if (this.pauseRequested) throw new WorkflowPaused();
    if (activity) this.update(activity);
  }
  pause() {
    this.pauseRequested = true;
    if (this.pending && !this.pending.busy) this.pending.cancel(new WorkflowPaused());
    this.publish();
  }
  stop() {
    this.controller.abort();
    this.pending?.cancel(); this.pending = undefined; this.publish();
  }
  finish(error) {
    this.state = error instanceof WorkflowPaused ? "paused" : this.signal.aborted ? "stopped" : error ? "failed" : "completed";
    this.activity = error?.message || "Finished";
    this.publish();
  }
  ask(title, show) {
    this.signal.throwIfAborted();
    if (this.pending) throw new Error("A human decision is already pending.");
    return new Promise((resolve, reject) => {
      const cancel = error => {
        this.signal.removeEventListener("abort", cancel); this.pending = undefined;
        reject(error instanceof Error ? error : this.signal.reason || new Error("Decision cancelled."));
      };
      this.signal.addEventListener("abort", cancel, { once: true });
      this.pending = { title, busy: false, cancel, respond: async () => {
        if (!this.pending || this.pending.busy || this.signal.aborted) return;
        this.pending.busy = true; this.publish();
        try { const result = await show(); this.signal.throwIfAborted(); resolve(result); }
        catch (error) { reject(error); }
        finally { this.signal.removeEventListener("abort", cancel); this.pending = undefined; this.publish(); }
      } };
      this.publish();
    });
  }
}
