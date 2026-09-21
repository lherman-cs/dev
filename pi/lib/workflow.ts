import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { decode, encode } from "@toon-format/toon";
import lockfile from "proper-lockfile";
import type { WorkflowControl } from "./workflow-control.ts";

export type WorkflowPhase = "build" | "prepare" | "review" | "ship";
export type ExecResult = { code: number; stdout: string; stderr: string };
export type Project = { root: string; dir: string };
export type ProjectMeta = {
  status: string;
  base?: string;
  base_branch?: string;
  final_checks?: string[];
  [key: string]: unknown;
};
export type ExecutionTask = {
  id: string;
  file: string;
  title?: string;
  goal?: string;
  checks: string[];
  depends_on?: string[];
  supersedes?: string | string[];
  requirements?: string[];
  source?: string | { finding_key?: string; candidate?: string; [key: string]: unknown };
  [key: string]: unknown;
};
export type ContractSet = { meta: ProjectMeta; tasks: ExecutionTask[]; all: ExecutionTask[] };
export type BuildState = { version: number; done: string[]; current: string | null; head: string };
export type DelegateOptions = {
  metadata?: Record<string, unknown>;
  tools?: string[];
  system?: string;
};
export type ReviewRepair = {
  key: string;
  title: string;
  goal: string;
  reason: string;
  evidence?: string[];
  requirements?: string[];
  checks: string[];
};
export type ReviewDecision = { action: "approve" | "feedback" | "repairs" | "cancel"; feedback?: string; keys?: string[] };
export type WorkflowHost = {
  cwd: string;
  signal?: AbortSignal;
  control?: WorkflowControl;
  lastWorkerId?: string;
  rawExec?: (program: string, args: string[]) => Promise<ExecResult>;
  exec(program: string, args: string[]): Promise<ExecResult>;
  checkpoint?(activity?: string): void;
  delegate<T = string>(name: string, task: string, skill?: string, schema?: unknown, options?: DelegateOptions): Promise<T>;
  workerOutcome?(id: string | undefined, outcome: string): void;
  select(title: string, choices: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  review(title: string, markdown: string, repairs?: ReviewRepair[]): Promise<ReviewDecision>;
  report(message: string): void;
  now?(): number;
  sleep?(ms: number): Promise<void>;
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const asObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
};

export const read = <T = unknown>(file: string): T => decode(fs.readFileSync(file, "utf8")) as unknown as T;
export function save(file: string, data: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, (encode as (value: unknown) => string)(data) + "\n");
  fs.renameSync(temporary, file);
}
export async function command(h: Pick<WorkflowHost, "exec">, program: string, args: string[]): Promise<string> {
  const result = await h.exec(program, args);
  if (result.code !== 0) throw new Error(`${program} ${args.join(" ")}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  return result.stdout.trim();
}
export const git = (h: Pick<WorkflowHost, "exec">, ...args: string[]): Promise<string> => command(h, "git", args);
export const clean = async (h: Pick<WorkflowHost, "exec">): Promise<boolean> => !(await git(h, "status", "--porcelain"));
export const ghJSON = async <T = any>(h: Pick<WorkflowHost, "exec">, args: string[]): Promise<T> => JSON.parse(await command(h, "gh", args)) as T;
const inside = (root: string, file: string): boolean => { const r = path.relative(root, file); return r !== ".." && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };

export async function resolveProject(h: WorkflowHost, target?: string): Promise<Project> {
  const root = fs.realpathSync(await git(h, "rev-parse", "--show-toplevel"));
  let value = String(target || "").trim();
  if (!value) {
    const parent = path.join(root, "plans");
    const dirs = fs.existsSync(parent) ? fs.readdirSync(parent, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];
    const picked = dirs.length === 1 ? dirs[0] : await h.select("Project", dirs);
    value = picked ? path.join(parent, picked) : "";
    if (!value) throw new Error("Select a project or pass its spec.md path.");
  }
  let dir = path.resolve(h.cwd, value);
  if (!fs.existsSync(dir) && !value.includes(path.sep)) dir = path.join(root, "plans", value);
  if (!fs.existsSync(dir)) throw new Error(`Target does not exist: ${dir} (working directory: ${h.cwd})`);
  dir = fs.realpathSync(dir);
  if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir);
  while (inside(root, dir)) {
    if (fs.existsSync(path.join(dir, "spec.md"))) return { root, dir };
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  throw new Error(`No spec.md found above ${value} within ${root}.`);
}

export async function excludeState(h: Pick<WorkflowHost, "exec">): Promise<void> {
  if (await git(h, "ls-files", "--", ":(top)plans")) throw new Error("plans/ contains tracked files; refusing to hide product files.");
  const file = await git(h, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!text.split(/\r?\n/).includes("/plans/")) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}/plans/\n`);
  }
}

function parseTask(file: string): ExecutionTask {
  const raw = asObject(read(file), file);
  const id = raw.id;
  const checks = raw.checks;
  if (typeof id !== "string" || !/^[PR]\d+$/.test(id) || !Array.isArray(checks) || checks.some(c => typeof c !== "string" || !c.trim())) {
    throw new Error(`Invalid contract: ${file}`);
  }
  const depends = raw.depends_on;
  const supersedes = raw.supersedes;
  return {
    ...raw,
    id,
    file,
    checks: checks as string[],
    depends_on: Array.isArray(depends) ? depends.filter((value): value is string => typeof value === "string") : undefined,
    supersedes: typeof supersedes === "string" || (Array.isArray(supersedes) && supersedes.every(value => typeof value === "string")) ? supersedes as string | string[] : undefined,
  } as ExecutionTask;
}

export function contracts(project: Project): ContractSet {
  const manifest = path.join(project.dir, "project.toon");
  if (!fs.existsSync(manifest)) throw new Error(`Found ${path.join(project.dir, "spec.md")}, but no execution plan. Run /dev-plan ${path.join(project.dir, "spec.md")} first; build does not invent approved tasks.`);
  const metaRaw = asObject(read(manifest), manifest);
  const meta: ProjectMeta = { ...metaRaw, status: typeof metaRaw.status === "string" ? metaRaw.status : "" } as ProjectMeta;
  if (meta.status !== "ready" || !/^Status:\s*APPROVED\s*$/mi.test(fs.readFileSync(path.join(project.dir, "spec.md"), "utf8"))) throw new Error("Spec and execution plan need explicit human approval before building.");
  let tasks = ["plans", "repairs"].flatMap(kind => {
    const dir = path.join(project.dir, kind);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^[PR]\d+\.toon$/.test(name)).sort().map(name => parseTask(path.join(dir, name))) : [];
  });
  const all = tasks;
  const superseded = new Set(tasks.flatMap(task => Array.isArray(task.supersedes) ? task.supersedes : task.supersedes ? [task.supersedes] : []));
  tasks = tasks.filter(task => !superseded.has(task.id));
  const ids = new Set(tasks.map(task => task.id));
  if (ids.size !== tasks.length) throw new Error("Duplicate execution contract IDs.");
  for (const task of tasks) {
    if ((task.depends_on || []).some(id => !ids.has(id) && !superseded.has(id))) throw new Error(`Unknown dependency in ${task.id}`);
  }
  if (!tasks.length) throw new Error("No execution contracts found. Run /dev-plan first.");
  return { meta, tasks, all };
}

export async function workflowFingerprint(h: WorkflowHost, project: Project): Promise<string> {
  const exec = h.rawExec || h.exec;
  const run = async (args: string[]): Promise<string> => {
    const result = await exec.call(h, "git", args);
    if (result.code !== 0) throw new Error(`Cannot revalidate worktree: ${result.stderr}`);
    return result.stdout;
  };
  const hash = createHash("sha256");
  for (const args of [["rev-parse", "HEAD"], ["status", "--porcelain=v1", "-uall"], ["diff", "HEAD", "--binary"]]) hash.update(await run(args)).update("\0");
  for (const file of (await run(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean)) {
    const absolute = path.resolve(project.root, file);
    if (!inside(project.root, absolute)) throw new Error("Untracked path escaped worktree.");
    hash.update(file).update("\0");
    hash.update(fs.lstatSync(absolute).isSymbolicLink() ? fs.readlinkSync(absolute) : fs.readFileSync(absolute));
  }
  hash.update(fs.readFileSync(path.join(project.dir, "spec.md")));
  const approved = contracts(project);
  hash.update(JSON.stringify([approved.meta, approved.all]));
  return hash.digest("hex");
}
export async function checks(h: Pick<WorkflowHost, "exec">, commands?: string[]): Promise<void> {
  for (const line of commands || []) await command(h, "bash", ["-c", line]);
}
async function verify(h: WorkflowHost, base: string, task: ExecutionTask): Promise<string> {
  const head = await git(h, "rev-parse", "HEAD");
  if (await git(h, "rev-parse", "HEAD^") !== base || await git(h, "rev-list", "--count", `${base}..${head}`) !== "1") throw new Error(`Expected exactly one commit for ${task.id}.`);
  const message = await git(h, "log", "-1", "--format=%B");
  if (!/^[a-z][a-z0-9-]*(\([^)]+\))?!?: .+/.test(message) || /\b[PR]\d{3,}\b|Plan-ID:/i.test(message)) throw new Error("Use a Conventional Commit without workflow IDs.");
  if (!await clean(h)) throw new Error("Worker left uncommitted changes.");
  await checks(h, task.checks);
  if (await git(h, "rev-parse", "HEAD") !== head || !await clean(h)) throw new Error("Verification changed HEAD or left a dirty worktree.");
  return head;
}

export async function build(h: WorkflowHost, project: Project): Promise<{ meta: ProjectMeta; tasks: ExecutionTask[] }> {
  const { meta, tasks } = contracts(project);
  const stateFile = path.join(project.dir, "progress.toon");
  const state: BuildState = fs.existsSync(stateFile)
    ? read<BuildState>(stateFile)
    : { version: 1, done: [], current: null, head: await git(h, "rev-parse", meta.base || "HEAD") };
  const accepted = new Set(state.done || []);
  if (state.current && !tasks.some(task => task.id === state.current)) throw new Error("Interrupted contract was removed or superseded; reconcile it before resuming.");
  if (!state.current && !await clean(h)) throw new Error("Preserve or commit unrelated changes before building.");
  if (!state.current && state.head !== await git(h, "rev-parse", "HEAD")) {
    if (!await h.confirm("HEAD changed", "Adopt the current clean HEAD? Only approve after reconciling the plans with those changes.")) throw new Error("Stopped without adopting a changed HEAD.");
    state.head = await git(h, "rev-parse", "HEAD");
  }
  while (tasks.some(task => !accepted.has(task.id))) {
    h.checkpoint?.("Selecting the next approved contract");
    const task = state.current
      ? tasks.find(candidate => candidate.id === state.current)
      : tasks.find(candidate => !accepted.has(candidate.id) && (candidate.depends_on || []).every(id => accepted.has(id)));
    if (!task) throw new Error("No dependency-ready task; review the dependency graph or interrupted task.");
    if (state.current && await git(h, "rev-parse", "HEAD") !== state.head) {
      try { state.head = await verify(h, state.head, task); accepted.add(task.id); state.done = [...accepted]; state.current = null; save(stateFile, state); continue; } catch { /* retain partial work for same-task retry */ }
    }
    state.current = task.id;
    save(stateFile, state);
    let failure = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      h.checkpoint?.();
      const role = attempt ? "build_retry" : "build";
      h.report(`${attempt ? "Retrying" : "Building"} ${task.id}: ${task.title || task.goal} (${accepted.size + 1}/${tasks.length}).`);
      const result = await h.delegate<string>(role, `Spec: ${path.join(project.dir, "spec.md")}\nExecution contract: ${task.file}\nAccepted predecessor: ${state.head}\n${failure}`, "dev-implement", undefined, { metadata: { label: `Builder · ${task.title || task.goal || task.id}`, task: task.goal || task.title || task.id, contract: task.id, attempt: attempt + 1, predecessor: state.head } });
      if (/\bNEEDS_REPLAN\b/.test(result)) throw Object.assign(new Error(result), { blocked: true });
      try {
        h.report(`Verifying ${task.id}: independent contract checks.`);
        h.workerOutcome?.(h.lastWorkerId, "Verifying independent contract checks");
        state.head = await verify(h, state.head, task);
        failure = "";
        break;
      } catch (error: unknown) {
        h.signal?.throwIfAborted();
        h.workerOutcome?.(h.lastWorkerId, `Verification failed: ${errorMessage(error)}`);
        failure = `Verification failed: ${errorMessage(error)}\nAmend the same contract commit; do not add another.`;
        if (!attempt) h.report(`${task.id} did not pass verification. Retrying the same commit.`);
      }
    }
    if (failure) throw new Error(failure);
    accepted.add(task.id);
    state.done = [...accepted]; state.current = null;
    save(stateFile, state);
    h.workerOutcome?.(h.lastWorkerId, `Verified and accepted: ${state.head}`);
    h.report(`Completed ${task.id} (${accepted.size}/${tasks.length}).`);
  }
  h.checkpoint?.("All approved contracts verified");
  return { meta, tasks };
}

export async function runWorkflow(h: WorkflowHost, phase: WorkflowPhase, target?: string): Promise<unknown> {
  const project = await resolveProject(h, target);
  h.cwd = project.root;
  if (h.control) h.control.snapshot = () => workflowFingerprint(h, project);
  await excludeState(h);
  const lockfilePath = await git(h, "rev-parse", "--path-format=absolute", "--git-path", "dev-workflow.lock");
  const release = await lockfile.lock(project.root, { lockfilePath, retries: 0 });
  try {
    if (phase === "build") return await build(h, project);
    const { shipping } = await import("./ship.ts");
    return await shipping(h, project, phase);
  } finally { await release(); }
}
