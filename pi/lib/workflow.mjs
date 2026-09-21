import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { decode, encode } from "@toon-format/toon";
import lockfile from "proper-lockfile";

export const read = (file) => decode(fs.readFileSync(file, "utf8"));
export function save(file, data) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, encode(data) + "\n");
  fs.renameSync(temporary, file);
}
export async function command(h, program, args) {
  const result = await h.exec(program, args);
  if (result.code !== 0) throw new Error(`${program} ${args.join(" ")}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  return result.stdout.trim();
}
export const git = (h, ...args) => command(h, "git", args);
export const clean = async (h) => !(await git(h, "status", "--porcelain"));
export const ghJSON = async (h, args) => JSON.parse(await command(h, "gh", args));
const inside = (root, file) => { const r = path.relative(root, file); return r !== ".." && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };

// Resolve real files, not substrings of 'plans'. Check the execution manifest later.
export async function resolveProject(h, target) {
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

export async function excludeState(h) {
  if (await git(h, "ls-files", "--", ":(top)plans")) throw new Error("plans/ contains tracked files; refusing to hide product files.");
  const file = await git(h, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!text.split(/\r?\n/).includes("/plans/")) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}/plans/\n`);
  }
}
export function contracts(project) {
  const manifest = path.join(project.dir, "project.toon");
  if (!fs.existsSync(manifest)) throw new Error(`Found ${path.join(project.dir, "spec.md")}, but no execution plan. Run /dev-plan ${path.join(project.dir, "spec.md")} first; build does not invent approved tasks.`);
  const meta = read(manifest);
  if (meta.status !== "ready" || !/^Status:\s*APPROVED\s*$/mi.test(fs.readFileSync(path.join(project.dir, "spec.md"), "utf8"))) throw new Error("Spec and execution plan need explicit human approval before building.");
  let tasks = ["plans", "repairs"].flatMap(kind => {
    const dir = path.join(project.dir, kind);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^[PR]\d+\.toon$/.test(n)).sort().map(n => ({ ...read(path.join(dir, n)), file: path.join(dir, n) })) : [];
  });
  const all = tasks;
  const superseded = new Set(tasks.flatMap(t => Array.isArray(t.supersedes) ? t.supersedes : t.supersedes ? [t.supersedes] : []));
  tasks = tasks.filter(t => !superseded.has(t.id));
  const ids = new Set(tasks.map(t => t.id));
  if (ids.size !== tasks.length) throw new Error("Duplicate execution contract IDs.");
  for (const t of tasks) {
    if (!/^[PR]\d+$/.test(t.id) || !Array.isArray(t.checks) || t.checks.some(c => typeof c !== "string" || !c.trim())) throw new Error(`Invalid contract: ${t.file}`);
    if ((t.depends_on || []).some(id => !ids.has(id) && !superseded.has(id))) throw new Error(`Unknown dependency in ${t.id}`);
  }
  if (!tasks.length) throw new Error("No execution contracts found. Run /dev-plan first.");
  return { meta, tasks, all };
}
/** Uses raw execution deliberately: taking a pause fingerprint must not enter
 * the pause gate recursively. Includes untracked contents and ignored contracts. */
export async function workflowFingerprint(h, project) {
  const exec = h.rawExec || h.exec;
  const run = async args => {
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
export async function checks(h, commands) {
  for (const line of commands || []) await command(h, "bash", ["-c", line]);
}
async function verify(h, base, task) {
  const head = await git(h, "rev-parse", "HEAD");
  if (await git(h, "rev-parse", "HEAD^") !== base || await git(h, "rev-list", "--count", `${base}..${head}`) !== "1") throw new Error(`Expected exactly one commit for ${task.id}.`);
  const message = await git(h, "log", "-1", "--format=%B");
  if (!/^[a-z][a-z0-9-]*(\([^)]+\))?!?: .+/.test(message) || /\b[PR]\d{3,}\b|Plan-ID:/i.test(message)) throw new Error("Use a Conventional Commit without workflow IDs.");
  if (!await clean(h)) throw new Error("Worker left uncommitted changes.");
  await checks(h, task.checks);
  if (await git(h, "rev-parse", "HEAD") !== head || !await clean(h)) throw new Error("Verification changed HEAD or left a dirty worktree.");
  return head;
}

export async function build(h, project) {
  const { meta, tasks } = contracts(project);
  const stateFile = path.join(project.dir, "progress.toon");
  const state = fs.existsSync(stateFile) ? read(stateFile) : { version: 1, done: [], current: null, head: await git(h, "rev-parse", meta.base || "HEAD") };
  const accepted = new Set(state.done || []);
  if (state.current && !tasks.some(t => t.id === state.current)) throw new Error("Interrupted contract was removed or superseded; reconcile it before resuming.");
  if (!state.current && !await clean(h)) throw new Error("Preserve or commit unrelated changes before building.");
  if (!state.current && state.head !== await git(h, "rev-parse", "HEAD")) {
    if (!await h.confirm("HEAD changed", "Adopt the current clean HEAD? Only approve after reconciling the plans with those changes.")) throw new Error("Stopped without adopting a changed HEAD.");
    state.head = await git(h, "rev-parse", "HEAD");
  }
  while (tasks.some(t => !accepted.has(t.id))) {
    h.checkpoint?.("Selecting the next approved contract");
    const task = state.current ? tasks.find(t => t.id === state.current) : tasks.find(t => !accepted.has(t.id) && (t.depends_on || []).every(id => accepted.has(id)));
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
      const result = await h.delegate(role, `Spec: ${path.join(project.dir, "spec.md")}\nExecution contract: ${task.file}\nAccepted predecessor: ${state.head}\n${failure}`, "dev-implement", undefined, { metadata: { label: `Builder · ${task.title || task.goal || task.id}`, task: task.goal || task.title, contract: task.id, attempt: attempt + 1, predecessor: state.head } });
      // Infrastructure failures throw from delegate: never retry with another model.
      if (/\bNEEDS_REPLAN\b/.test(result)) throw Object.assign(new Error(result), { blocked: true });
      try {
        h.report(`Verifying ${task.id}: independent contract checks.`);
        h.workerOutcome?.(h.lastWorkerId, "Verifying independent contract checks");
        state.head = await verify(h, state.head, task);
        failure = "";
        break;
      } catch (error) {
        h.signal?.throwIfAborted();
        h.workerOutcome?.(h.lastWorkerId, `Verification failed: ${error.message}`);
        failure = `Verification failed: ${error.message}\nAmend the same contract commit; do not add another.`;
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

export async function runWorkflow(h, phase, target) {
  if (!["build", "prepare", "review", "ship"].includes(phase)) throw new Error(`Unknown phase ${phase}`);
  const project = await resolveProject(h, target);
  h.cwd = project.root;
  if (h.control) h.control.snapshot = () => workflowFingerprint(h, project);
  await excludeState(h);
  const lockfilePath = await git(h, "rev-parse", "--path-format=absolute", "--git-path", "dev-workflow.lock");
  const release = await lockfile.lock(project.root, { lockfilePath, retries: 0 });
  try {
    if (phase === "build") return await build(h, project);
    const { shipping } = await import("./ship.mjs");
    return await shipping(h, project, phase);
  } finally { await release(); }
}
