export type WorkflowPhase = "build" | "prepare" | "review" | "ship";
export type WorkflowState = "running" | "paused" | "stopped" | "failed" | "completed";

export class WorkflowPaused extends Error {
  constructor() {
    super("Paused at a safe boundary. Progress is preserved.");
    this.name = "WorkflowPaused";
  }
}

export interface PendingDecision<T = unknown> {
  readonly title: string;
  busy: boolean;
  cancel(error?: unknown): void;
  respond(): Promise<void>;
}

type Snapshot = () => Promise<string>;
type Changed = () => void;

/** Human controls over the existing controller, not another workflow state machine. */
export class WorkflowControl {
  readonly phase: WorkflowPhase;
  readonly target: string;
  readonly changed: Changed;
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly resumeCommand: string;
  state: WorkflowState = "running";
  activity = "Starting";
  pauseRequested = false;
  snapshot?: Snapshot;
  fingerprint?: string;
  pending: PendingDecision<unknown> | undefined;

  constructor(phase: WorkflowPhase, target: string, changed: Changed = () => {}) {
    this.phase = phase;
    this.target = target;
    this.changed = changed;
    this.resumeCommand = `/dev-${phase}${target ? ` ${target}` : ""}`;
  }

  publish(): void {
    try { this.changed(); } catch { /* UI failure must not change workflow outcome. */ }
  }

  async capturePause(): Promise<void> {
    if (this.snapshot) this.fingerprint = await this.snapshot();
  }

  async verifyResume(): Promise<void> {
    if (this.state !== "paused") throw new Error("No safely paused workflow. Reconcile and rerun the original phase command.");
    if (!this.snapshot || !this.fingerprint) throw new Error("No pause evidence available. Reconcile and rerun the original phase command.");
    if (await this.snapshot() !== this.fingerprint) {
      throw new Error("Worktree or approved contracts changed while paused. Reconcile the changes and rerun the phase explicitly; fast continuation was refused.");
    }
  }

  update(activity: string): void {
    this.activity = activity;
    this.publish();
  }

  checkpoint(activity?: string): void {
    this.signal.throwIfAborted();
    if (this.pauseRequested) throw new WorkflowPaused();
    if (activity) this.update(activity);
  }

  pause(): void {
    this.pauseRequested = true;
    if (this.pending && !this.pending.busy) this.pending.cancel(new WorkflowPaused());
    this.publish();
  }

  stop(): void {
    this.controller.abort();
    this.pending?.cancel();
    this.pending = undefined;
    this.publish();
  }

  finish(error?: unknown): void {
    this.state = error instanceof WorkflowPaused ? "paused" : this.signal.aborted ? "stopped" : error ? "failed" : "completed";
    this.activity = error instanceof Error ? error.message : error ? String(error) : "Finished";
    this.publish();
  }

  ask<T>(title: string, show: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    if (this.pending) throw new Error("A human decision is already pending.");
    return new Promise<T>((resolve, reject) => {
      const cancel = (error?: unknown): void => {
        this.signal.removeEventListener("abort", cancel);
        this.pending = undefined;
        reject(error instanceof Error ? error : this.signal.reason || new Error("Decision cancelled."));
      };
      this.signal.addEventListener("abort", cancel, { once: true });
      const pending: PendingDecision<T> = {
        title,
        busy: false,
        cancel,
        respond: async (): Promise<void> => {
          if (this.pending !== pending || pending.busy || this.signal.aborted) return;
          pending.busy = true;
          this.publish();
          try {
            const result = await show();
            this.signal.throwIfAborted();
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            this.signal.removeEventListener("abort", cancel);
            if (this.pending === pending) this.pending = undefined;
            this.publish();
          }
        },
      };
      this.pending = pending as PendingDecision<unknown>;
      this.publish();
    });
  }
}
