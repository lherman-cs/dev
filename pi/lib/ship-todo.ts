import { createJiti } from "jiti";
import type { ShipPhase, ShipState } from "./ship-runtime.ts";

type Status = "pending" | "in_progress" | "completed" | "deleted";
interface Task { id: number; subject: string; status: Status; activeForm?: string; blockedBy?: number[]; metadata?: Record<string, unknown> }
interface TaskState { tasks: Task[]; nextId: number }
interface Reduction { state: TaskState; op: { kind: string; message?: string } }
const jiti = createJiti(import.meta.url);
const { applyTaskMutation } = await jiti.import("@juicesharp/rpiv-todo/state/state-reducer.ts") as { applyTaskMutation(state: TaskState, action: string, params: Record<string, unknown>): Reduction };
const { commitState, getState } = await jiti.import("@juicesharp/rpiv-todo/state/store.ts") as { commitState(sessionId: string, state: TaskState): void; getState(sessionId: string): TaskState };

const phases = [
  ["admit", "Admit build handoff", "admitting build handoff"],
  ["rebase", "Rebase candidate", "rebasing candidate"],
  ["format", "Check formatting", "checking formatting"],
  ["lint", "Run lint", "running lint"],
  ["test", "Run required proof", "running required proof"],
  ["publish", "Publish draft PR", "publishing draft PR"],
  ["wait", "Observe CI and bots", "observing CI and bots"],
  ["audit", "Audit candidate", "auditing candidate"],
  ["approve", "Approve exact packet", "awaiting exact approval"],
] as const;

type PhaseKey = typeof phases[number][0];
const completeThrough: Record<ShipPhase, number> = { handoff: 0, prepared: 4, published: 5, waiting: 6, audited: 7, repairing: 7, approved: 8, ready: 8, stopped: -1 };
const metadata = (task: Task): Record<string, unknown> => task.metadata ?? {};
const owned = (task: Task, invocationId: string): boolean => metadata(task)["shipInvocation"] === invocationId;

function apply(state: TaskState, action: "create" | "update" | "delete", params: Record<string, unknown>): TaskState {
  const result = applyTaskMutation(state, action, params);
  if (result.op.kind === "error") throw new Error(`Ship todo projection failed: ${result.op.message}`);
  return result.state;
}

/** Reconciles only invocation-owned tasks. Runtime state, never todo state, determines progress. */
export function reconcileShipTodos(sessionId: string, ship: ShipState): readonly Task[] {
  let state = getState(sessionId);
  const head = ship.candidate.branch.head;
  const generation = `${ship.repairs}:${head}`;
  for (const task of state.tasks) {
    if (owned(task, ship.invocationId) && metadata(task)["shipGeneration"] !== generation && task.status !== "deleted") state = apply(state, "delete", { id: task.id });
  }
  let previous: number | undefined;
  phases.forEach(([key, subject, activeForm], index) => {
    let task = state.tasks.find(item => owned(item, ship.invocationId) && metadata(item)["shipGeneration"] === generation && metadata(item)["shipPhase"] === key);
    if (!task) {
      state = apply(state, "create", { subject: `${subject} ${head.slice(0, 8)}`, activeForm, ...(previous ? { blockedBy: [previous] } : {}), metadata: { shipInvocation: ship.invocationId, shipGeneration: generation, shipPhase: key satisfies PhaseKey } });
      task = state.tasks[state.tasks.length - 1];
    }
    if (!task) throw new Error("Ship todo projection did not create a task.");
    const completed = index <= completeThrough[ship.phase];
    const active = !completed && index === completeThrough[ship.phase] + 1 && ship.phase !== "stopped";
    if (completed && task.status === "pending") state = apply(state, "update", { id: task.id, status: "in_progress" });
    task = state.tasks.find(item => item.id === task?.id);
    if (completed && task?.status === "in_progress") state = apply(state, "update", { id: task.id, status: "completed" });
    else if (active && task?.status === "pending") state = apply(state, "update", { id: task.id, status: "in_progress" });
    previous = task?.id;
  });
  commitState(sessionId, state);
  return state.tasks;
}
