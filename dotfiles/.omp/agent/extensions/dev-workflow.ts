import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".omp", "agent");
const SKILL_ROOT = process.env.DEV_WORKFLOW_SKILL_ROOT || path.join(AGENT_DIR, "skills");
const WORKFLOW_CONFIG = process.env.DEV_WORKFLOW_CONFIG || path.join(AGENT_DIR, "dev-workflow.yml");
const PLAN_RE = /^P\d+\.toon$/;
const REPAIR_RE = /^R\d+\.toon$/;
const BUILD_MAX_ATTEMPTS = 2;
const SHIP_MAX_REPAIR_ROUNDS = 2;
const SHIP_POLL_MS = 20_000;
const SHIP_SETTLE_MS = 60_000;

function skillPath(skill) {
  return path.join(SKILL_ROOT, skill, "SKILL.md");
}

function readSkill(skill) {
  const file = skillPath(skill);
  if (!fs.existsSync(file)) throw new Error(`Missing installed skill ${file}`);
  return fs.readFileSync(file, "utf8");
}

function run(command, args, cwd, input, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...(env || {}) }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input === undefined ? undefined : input);
  });
}

async function git(cwd, args) {
  const r = await run("git", args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

async function decodeToon(file) {
  const r = await run("toon", [file], path.dirname(file));
  if (r.code !== 0) throw new Error(`TOON decode failed for ${file}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
}

async function writeToon(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await run("toon", ["--encode"], path.dirname(file), JSON.stringify(value));
  if (r.code !== 0) throw new Error(`TOON encode failed for ${file}: ${r.stderr.trim()}`);
  const encoded = r.stdout.endsWith("\n") ? r.stdout : `${r.stdout}\n`;
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, encoded);
  fs.renameSync(temp, file);
}

function findProjects(cwd) {
  const root = path.join(cwd, "plans");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, "project.toon")))
    .map((e) => ({ name: e.name, dir: path.join(root, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function projectFromTarget(cwd, target) {
  const raw = String(target || "").trim();
  if (!raw) return undefined;

  const normalized = path.normalize(raw).replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const plansIndex = parts.lastIndexOf("plans");
  if (plansIndex >= 0 && parts[plansIndex + 1]) {
    const name = parts[plansIndex + 1];
    return { name, dir: path.join(cwd, "plans", name) };
  }

  if (!raw.includes("/") && !raw.includes("\\")) {
    return { name: raw, dir: path.join(cwd, "plans", raw) };
  }

  return undefined;
}

async function chooseProject(ctx, arg) {
  const projects = findProjects(ctx.cwd);
  const target = String(arg || "").trim();
  if (target) {
    const project = projectFromTarget(ctx.cwd, target);
    if (project) return project;
    throw new Error(`Expected a project name or plans/<project>/... path, got ${target}`);
  }
  if (projects.length === 1) return projects[0];
  if (projects.length === 0) throw new Error("No planned project under plans/<project>. Run /dev-spec and /dev-plan first.");
  if (!ctx.hasUI) throw new Error("Multiple projects found; pass a project name or plans/<project>/... path.");
  const picked = await ctx.ui.select("Project", projects.map((p) => p.name));
  return projects.find((p) => p.name === picked);
}

async function loadProject(project) {
  const projectFile = path.join(project.dir, "project.toon");
  if (!fs.existsSync(projectFile)) {
    throw new Error(`Missing ${projectFile}. Run /dev-plan first.`);
  }
  const data = await decodeToon(projectFile);
  if (data.status !== "ready") throw new Error(`${projectFile} is not approved/ready.`);
  const plansDir = path.join(project.dir, "plans");
  const repairsDir = path.join(project.dir, "repairs");
  const entries = [];
  if (fs.existsSync(plansDir)) {
    for (const name of fs.readdirSync(plansDir).filter((n) => PLAN_RE.test(n)).sort()) {
      entries.push({ file: path.join(plansDir, name), data: await decodeToon(path.join(plansDir, name)), kind: "plan" });
    }
  }
  if (fs.existsSync(repairsDir)) {
    for (const name of fs.readdirSync(repairsDir).filter((n) => REPAIR_RE.test(n)).sort()) {
      const data = await decodeToon(path.join(repairsDir, name));
      entries.push({ file: path.join(repairsDir, name), data, kind: "repair" });
    }
  }
  return { data, entries };
}

async function ensureIgnored(cwd) {
  const tracked = await git(cwd, ["ls-files", "--", "plans"]);
  if (tracked) throw new Error("Workflow state uses plans/, but this repository already tracks files there.");

  const ignored = await run("git", ["check-ignore", "-q", "--no-index", "plans/"], cwd);
  if (ignored.code === 0) return;

  const gitPath = await git(cwd, ["rev-parse", "--git-path", "info/exclude"]);
  const exclude = path.isAbsolute(gitPath) ? gitPath : path.resolve(cwd, gitPath);
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
  if (!current.split(/\r?\n/).some((line) => line.trim() === "/plans/")) {
    fs.appendFileSync(exclude, `${current && !current.endsWith("\n") ? "\n" : ""}/plans/\n`);
  }
}

async function statusPorcelain(cwd) {
  return git(cwd, ["status", "--porcelain=v1", "--untracked-files=normal"]);
}

function blockedCheck(command) {
  return /(^|[;&|]\s*)(rm\s+-rf|git\s+(reset|clean|rebase|push|merge)|sudo\b)/i.test(command);
}

async function runChecks(cwd, checks) {
  for (const command of checks || []) {
    if (blockedCheck(command)) throw new Error(`Refusing unsafe plan check: ${command}`);
    const r = await run("bash", ["-lc", command], cwd);
    if (r.code !== 0) return { ok: false, command, stdout: r.stdout.slice(-5000), stderr: r.stderr.slice(-5000) };
  }
  return { ok: true };
}

async function loadProgress(project, projectData) {
  const file = path.join(project.dir, "progress.toon");
  if (!fs.existsSync(file)) {
    const data = { version: 1, project: projectData.name || project.name, done: [], current: null, head: projectData.base };
    await writeToon(file, data);
    return { file, data };
  }
  return { file, data: await decodeToon(file) };
}

function supersededIds(entries) {
  return new Set(entries.map((entry) => entry.data.supersedes).filter(Boolean));
}

function nextReady(entries, done) {
  for (const entry of entries) {
    if (done.has(entry.data.id)) continue;
    if ((entry.data.depends_on || []).every((id) => done.has(id))) return entry;
  }
  return undefined;
}

async function recoverCurrentPlan(ctx, progress, entries) {
  const id = progress.data.current;
  if (!id) return false;
  const entry = entries.find((candidate) => candidate.data.id === id);
  if (!entry) return false;
  const head = await git(ctx.cwd, ["rev-parse", "HEAD"]);
  if (head === progress.data.head) return false;
  const validation = await validatePlanCommit(ctx.cwd, progress.data.head, entry.data);
  if (!validation.ok) return false;
  progress.data.done = [...new Set([...(progress.data.done || []), id])];
  progress.data.current = null;
  progress.data.head = validation.head;
  await writeToon(progress.file, progress.data);
  ctx.ui.notify(`Recovered ${id} from existing validated commit.`, "info");
  return true;
}

async function maybeAdoptHumanHead(ctx, progress) {
  const head = await git(ctx.cwd, ["rev-parse", "HEAD"]);
  if (head === progress.data.head || progress.data.current) return;
  const dirty = await statusPorcelain(ctx.cwd);
  if (dirty) throw new Error("HEAD moved outside dev-build and the worktree is dirty. Reconcile manually first.");
  const ok = ctx.hasUI && await ctx.ui.confirm("Git changed", `Adopt ${head.slice(0, 12)} as the new build base? Only approve if plans already reflect the manual change.`);
  if (!ok) throw new Error("Build stopped without adopting the new HEAD.");
  progress.data.head = head;
  await writeToon(progress.file, progress.data);
}

function extractMessageText(message) {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content.filter((c) => c?.type === "text").map((c) => c.text || "").join("\n").trim();
}

function makeTempPrompt(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-workflow-"));
  const file = path.join(dir, "system.md");
  fs.writeFileSync(file, text);
  return { dir, file };
}

function workflowConfigArgs() {
  if (!fs.existsSync(WORKFLOW_CONFIG)) throw new Error(`Missing workflow config ${WORKFLOW_CONFIG}. Re-run install.sh.`);
  return ["--config", WORKFLOW_CONFIG];
}

function spawnJsonAgent(cwd, role, systemPrompt, prompt, tools, onEvent, signal) {
  return new Promise((resolve) => {
    const tmp = makeTempPrompt(systemPrompt);
    const args = [...workflowConfigArgs(), "--mode", "json", "-p", "--no-session", "--model", `@${role}`];
    const allowedTools = [...new Set([...(tools || []), "task", "hub"])];
    if (allowedTools.length) args.push("--tools", allowedTools.join(","));
    args.push("--append-system-prompt", tmp.file, "--", prompt);
    const child = spawn("omp", args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let finalText = "";
    let lastUsage = {};
    let aborted = false;

    const cleanup = () => { try { fs.rmSync(tmp.dir, { recursive: true, force: true }); } catch {} };
    const processLine = (line) => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === "message_update" && event.usage) lastUsage = event.usage;
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const text = extractMessageText(event.message);
        if (text) finalText = text;
        if (event.message.usage) lastUsage = event.message.usage;
      }
      onEvent?.(event, { finalText, usage: lastUsage });
    };

    child.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => { cleanup(); resolve({ code: -1, stdout: finalText, stderr: `${stderr}${error.message}`, usage: lastUsage, aborted }); });
    child.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      cleanup();
      resolve({ code: code ?? -1, stdout: finalText, stderr, usage: lastUsage, aborted });
    });

    const abort = () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 3000).unref?.();
    };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
  });
}

async function runVisibleAgent(ctx, options) {
  const key = "dev-worker";
  const recent = [];
  if (ctx.hasUI) {
    ctx.ui.setStatus(key, `${options.title} · @${options.role}`);
    ctx.ui.setWidget(key, [`● ${options.title} · @${options.role}`]);
  }
  try {
    return await spawnJsonAgent(ctx.cwd, options.role, options.system, options.prompt, options.tools, (event) => {
      if (!ctx.hasUI) return;
      if (event.type === "tool_execution_start") recent.push(`● ${event.toolName || "tool"}`);
      else if (event.type === "tool_execution_end") recent.push(`${event.isError ? "✗" : "✓"} ${event.toolName || "tool"}`);
      if (recent.length > 6) recent.splice(0, recent.length - 6);
      ctx.ui.setWidget(key, [`● ${options.title} · @${options.role}`, ...recent]);
    }, options.signal);
  } finally {
    if (ctx.hasUI) {
      ctx.ui.setStatus(key, undefined);
      ctx.ui.setWidget(key, undefined);
    }
  }
}

const CONVENTIONAL_COMMIT_RE = /^[a-z][a-z0-9-]*(\([^)]+\))?!?: .+/;

async function validatePlanCommit(cwd, base, plan) {
  const head = await git(cwd, ["rev-parse", "HEAD"]);
  const count = Number(await git(cwd, ["rev-list", "--count", `${base}..${head}`]));
  if (count !== 1) return { ok: false, reason: `expected exactly one commit for ${plan.id}, found ${count}` };
  const message = await git(cwd, ["log", "-1", "--format=%B"]);
  const subject = message.split("\n", 1)[0];
  if (!CONVENTIONAL_COMMIT_RE.test(subject)) return { ok: false, reason: `commit is not Conventional Commits format: ${subject}` };
  const workflowId = /\b[PR]\d{3,}\b/i;
  if (workflowId.test(message) || /\bPlan-ID\s*:/i.test(message)) return { ok: false, reason: "commit message leaks workflow metadata" };
  const dirty = await statusPorcelain(cwd);
  if (dirty) return { ok: false, reason: `worktree is not clean after Builder:\n${dirty}` };
  const checks = await runChecks(cwd, plan.checks || []);
  if (!checks.ok) return { ok: false, reason: `verification failed: ${checks.command}\n${checks.stderr || checks.stdout}` };
  return { ok: true, head };
}

async function runPlan(ctx, project, progress, entry) {
  const max = BUILD_MAX_ATTEMPTS;
  const plan = entry.data;
  const base = progress.data.head;
  progress.data.current = plan.id;
  await writeToon(progress.file, progress.data);
  let failure = "";

  for (let attempt = 1; attempt <= max; attempt++) {
    const role = attempt === 1 ? "build" : "build_retry";
    const prompt = [
      `Project spec: ${path.join(project.dir, "spec.md")}`,
      `Execution contract: ${entry.file}`,
      `Accepted predecessor: ${base}`,
      failure ? `Previous attempt evidence:\n${failure}` : "",
    ].filter(Boolean).join("\n\n");
    const result = await runVisibleAgent(ctx, {
      title: `${plan.id} · ${plan.title || "Builder"}`,
      role,
      system: readSkill("dev-implement"),
      prompt,
      tools: ["read", "bash", "edit", "write", "lsp"],
    });
    if (result?.aborted) throw new Error(`${plan.id} aborted. Work is preserved; progress was not advanced.`);
    if (/\bNEEDS_REPLAN\b/.test(result.stdout || "")) throw new Error(`${plan.id} is blocked by its approved plan. Run /dev-plan to revise remaining work.\n${String(result.stdout).slice(-3000)}`);
    const validation = await validatePlanCommit(ctx.cwd, base, plan);
    if (result.code === 0 && validation.ok) {
      progress.data.done = [...new Set([...(progress.data.done || []), plan.id])];
      progress.data.current = null;
      progress.data.head = validation.head;
      await writeToon(progress.file, progress.data);
      return;
    }
    failure = validation.reason || result.stderr || result.stdout || `Builder exited ${result.code}`;
  }
  throw new Error(`${plan.id} failed after ${max} bounded attempts. Work is preserved.\n${String(failure).slice(-4000)}`);
}

async function driveBuild(ctx, args) {
  await ensureIgnored(ctx.cwd);
  const project = await chooseProject(ctx, args);
  if (!project) return;
  const loaded = await loadProject(project);
  const progress = await loadProgress(project, loaded.data);
  const superseded = supersededIds(loaded.entries);
  if (progress.data.current && superseded.has(progress.data.current)) {
    progress.data.current = null;
    await writeToon(progress.file, progress.data);
  }
  await recoverCurrentPlan(ctx, progress, loaded.entries);
  await maybeAdoptHumanHead(ctx, progress);
  const done = new Set(progress.data.done || []);
  const ids = new Set(loaded.entries.map((e) => e.data.id));
  for (const id of done) if (!ids.has(id)) throw new Error(`progress.toon references missing approved work ${id}`);
  const active = loaded.entries.filter((entry) => !superseded.has(entry.data.id));

  while (active.some((entry) => !done.has(entry.data.id))) {
    const next = progress.data.current ? active.find((e) => e.data.id === progress.data.current) : nextReady(active, done);
    if (!next) throw new Error("No dependency-ready approved work remains. Run /dev-plan to repair dependencies/state.");
    const complete = active.filter((entry) => done.has(entry.data.id)).length;
    ctx.ui.setStatus("dev-build", `${project.name} · ${complete}/${active.length} · ${next.data.id}`);
    await runPlan(ctx, project, progress, next);
    done.add(next.data.id);
  }
  ctx.ui.setStatus("dev-build", undefined);
  ctx.ui.notify(`Build complete: ${active.length}/${active.length} approved plans/repairs.`, "info");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shipSettings() {
  return {
    maxRepairRounds: SHIP_MAX_REPAIR_ROUNDS,
    pollMs: SHIP_POLL_MS,
    settleMs: SHIP_SETTLE_MS,
  };
}

async function loadShip(project) {
  const file = path.join(project.dir, "ship.toon");
  if (!fs.existsSync(file)) {
    const data = {
      version: 1,
      phase: "build",
      repair_round: 0,
      verified_head: null,
      candidate: null,
      approved_head: null,
      last_failure: null,
      blocked: null,
    };
    await writeToon(file, data);
    return { file, data };
  }
  return { file, data: await decodeToon(file) };
}

async function saveShip(ship) {
  await writeToon(ship.file, ship.data);
}

async function setShipPhase(ship, phase) {
  ship.data.phase = phase;
  await saveShip(ship);
}

async function blockShip(ship, reason, resume = "build") {
  ship.data.phase = "blocked";
  ship.data.blocked = { reason: String(reason).slice(0, 3000), resume };
  await saveShip(ship);
}

async function gh(cwd, args) {
  const r = await run("gh", args, cwd);
  if (r.code !== 0) throw new Error(`gh ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

async function ghJson(cwd, args) {
  const text = await gh(cwd, args);
  return text ? JSON.parse(text) : {};
}

async function currentPr(cwd) {
  const r = await run("gh", ["pr", "view", "--json", "number,url,isDraft,headRefOid,baseRefName,updatedAt"], cwd);
  return r.code === 0 ? JSON.parse(r.stdout) : null;
}

function nextRepairId(entries) {
  const ids = entries
    .map((entry) => /^R(\d+)$/.exec(String(entry.data.id || "")))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  return `R${String((ids.length ? Math.max(...ids) : 0) + 1).padStart(3, "0")}`;
}

async function planFinalGateRepair(project, loaded, ship, failure) {
  const settings = shipSettings();
  const evidence = String(failure.stderr || failure.stdout || "").trim().slice(-1600);
  const signature = `${failure.command}\n${evidence}`;
  if (ship.data.last_failure === signature) {
    await blockShip(ship, `The same final-gate failure survived its repair: ${failure.command}`);
    return;
  }
  if (ship.data.repair_round >= settings.maxRepairRounds) {
    await blockShip(ship, `Automatic repair limit reached at final gate: ${failure.command}`);
    return;
  }

  const id = nextRepairId(loaded.entries);
  const active = loaded.entries.filter((entry) => !supersededIds(loaded.entries).has(entry.data.id));
  await writeToon(path.join(project.dir, "repairs", `${id}.toon`), {
    version: 1,
    id,
    title: `Repair final gate: ${failure.command}`,
    depends_on: active.map((entry) => entry.data.id),
    goal: `Make the final acceptance command pass while preserving the approved spec: ${failure.command}`,
    requirements: [
      "Find and fix the root cause, not only the observed symptom.",
      "Preserve approved behavior and architecture.",
      evidence ? `Failure evidence: ${evidence}` : "Reproduce the failure from the declared command.",
    ],
    checks: [failure.command],
    source: { kind: "final_gate" },
  });
  ship.data.repair_round += 1;
  ship.data.last_failure = signature;
  ship.data.verified_head = null;
  ship.data.candidate = null;
  ship.data.approved_head = null;
  ship.data.phase = "build";
  await saveShip(ship);
}

function finalChecks(projectData, cwd) {
  if (Array.isArray(projectData.final_checks) && projectData.final_checks.length) return projectData.final_checks;
  if (fs.existsSync(path.join(cwd, "Justfile")) || fs.existsSync(path.join(cwd, "justfile"))) return ["just check", "just test"];
  return [];
}

function conflictResolverSystem() {
  return [
    "Resolve only the current rebase-conflicted files while preserving the approved spec and existing commit intent.",
    "Do not run Git sequencing/mutation commands; the controller owns them.",
    "If resolution needs a new product/API/architecture/scope decision, return NEEDS_HUMAN with evidence.",
  ].join("\n");
}

async function resolveConflicts(ctx, project, conflicts) {
  const result = await runVisibleAgent(ctx, {
    title: "Rebase conflicts",
    role: "build_retry",
    system: conflictResolverSystem(),
    prompt: [
      `Approved spec: ${path.join(project.dir, "spec.md")}`,
      `Conflicted files:\n${conflicts.map((file) => `- ${file}`).join("\n")}`,
      "Resolve the files and leave Git sequencing to the controller.",
    ].join("\n\n"),
    tools: ["read", "grep", "glob", "edit", "write", "lsp"],
  });
  if (result?.aborted) throw new Error("Conflict resolution was interrupted; the rebase is preserved.");
  if (/\bNEEDS_HUMAN\b/.test(result.stdout || "")) return { blocked: true, reason: result.stdout };
  if (result.code !== 0) throw new Error(`Conflict resolver failed: ${result.stderr || result.stdout}`);
  const remaining = await git(ctx.cwd, ["diff", "--name-only", "--diff-filter=U"]);
  if (remaining) throw new Error(`Conflict resolver left unresolved files:\n${remaining}`);
  await git(ctx.cwd, ["add", "-A", "--", ...conflicts]);
  return { blocked: false };
}

async function rebaseActive(cwd) {
  const gitDir = path.resolve(cwd, await git(cwd, ["rev-parse", "--git-dir"]));
  return fs.existsSync(path.join(gitDir, "rebase-merge")) || fs.existsSync(path.join(gitDir, "rebase-apply"));
}

async function finishRebase(ctx, project, ship) {
  while (true) {
    if (!(await rebaseActive(ctx.cwd))) return true;
    const conflicts = (await git(ctx.cwd, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean);
    if (conflicts.length) {
      const resolved = await resolveConflicts(ctx, project, conflicts);
      if (resolved.blocked) {
        await blockShip(ship, resolved.reason || "Rebase requires a semantic decision.", "prepare");
        return false;
      }
    }
    const continued = await run("git", ["-c", "core.editor=true", "rebase", "--continue"], ctx.cwd, undefined, { GIT_EDITOR: "true" });
    if (continued.code !== 0) {
      const more = await git(ctx.cwd, ["diff", "--name-only", "--diff-filter=U"]);
      if (!more) throw new Error(`git rebase --continue failed: ${(continued.stderr || continued.stdout).trim()}`);
    }
  }
}

async function prepareShipCandidate(ctx, project, loaded, ship) {
  const baseBranch = loaded.data.base_branch || "main";
  if (await rebaseActive(ctx.cwd)) {
    if (!(await finishRebase(ctx, project, ship))) return;
  } else {
    const dirty = await statusPorcelain(ctx.cwd);
    if (dirty) throw new Error(`Prepare requires a clean worktree:\n${dirty}`);
    await git(ctx.cwd, ["fetch", "origin", baseBranch]);
    const rebase = await run("git", ["rebase", `origin/${baseBranch}`], ctx.cwd, undefined, { GIT_EDITOR: "true" });
    if (rebase.code !== 0) {
      if (!(await rebaseActive(ctx.cwd))) throw new Error(`git rebase failed: ${(rebase.stderr || rebase.stdout).trim()}`);
      if (!(await finishRebase(ctx, project, ship))) return;
    }
  }
  if (ship.data.phase === "blocked") return;

  const head = await git(ctx.cwd, ["rev-parse", "HEAD"]);
  const progress = await loadProgress(project, loaded.data);
  progress.data.current = null;
  progress.data.head = head;
  await writeToon(progress.file, progress.data);

  if (ship.data.verified_head !== head) {
    const checked = await runChecks(ctx.cwd, finalChecks(loaded.data, ctx.cwd));
    if (!checked.ok) {
      await planFinalGateRepair(project, loaded, ship, checked);
      return;
    }
    ship.data.verified_head = head;
    ship.data.last_failure = null;
    await saveShip(ship);
  }

  const branch = await git(ctx.cwd, ["branch", "--show-current"]);
  if (!branch) throw new Error("Shipping requires a named branch.");
  await git(ctx.cwd, ["push", "--force-with-lease", "-u", "origin", `HEAD:${branch}`]);

  let pr = await currentPr(ctx.cwd);
  if (!pr) {
    const title = loaded.data.title || loaded.data.name || branch;
    await gh(ctx.cwd, ["pr", "create", "--draft", "--base", baseBranch, "--head", branch, "--title", String(title), "--body", "Draft candidate managed by the OMP dev workflow."]);
    pr = await currentPr(ctx.cwd);
  }
  if (!pr || pr.headRefOid !== head) throw new Error("Published PR does not match the verified local HEAD.");

  ship.data.candidate = {
    head,
    base: await git(ctx.cwd, ["rev-parse", `origin/${baseBranch}`]),
    base_branch: baseBranch,
    pr: pr.number,
    url: pr.url,
    published_at: new Date().toISOString(),
  };
  ship.data.approved_head = null;
  ship.data.phase = "await";
  await saveShip(ship);
}

function checksPending(checks) {
  return checks.some((check) => {
    const bucket = String(check.bucket || "").toLowerCase();
    const state = String(check.state || "").toUpperCase();
    return bucket === "pending" || ["QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "EXPECTED", "REQUESTED"].includes(state);
  });
}

async function awaitShipSignals(ctx, ship) {
  const candidate = ship.data.candidate;
  if (!candidate) throw new Error("Await phase has no candidate.");
  const settings = shipSettings();
  let signature = "";
  let stableSince = 0;

  while (true) {
    const pr = await ghJson(ctx.cwd, ["pr", "view", String(candidate.pr), "--json", "headRefOid,updatedAt"]);
    if (pr.headRefOid !== candidate.head) {
      await blockShip(ship, `PR #${candidate.pr} moved away from candidate ${candidate.head}.`, "prepare");
      return;
    }

    const checkResult = await run("gh", ["pr", "checks", String(candidate.pr), "--json", "name,state,bucket,workflow"], ctx.cwd);
    let checks;
    try { checks = JSON.parse(checkResult.stdout || "[]"); }
    catch { throw new Error(`Could not parse PR checks: ${checkResult.stderr || checkResult.stdout}`); }
    const current = JSON.stringify({ checks, updatedAt: pr.updatedAt });
    if (checksPending(checks)) {
      signature = "";
      stableSince = 0;
      ctx.ui.setStatus("dev-ship", `await · ${checks.filter((check) => String(check.bucket || "").toLowerCase() === "pending").length} pending`);
    } else if (current !== signature) {
      signature = current;
      stableSince = Date.now();
      ctx.ui.setStatus("dev-ship", "await · checks terminal, settling feedback");
    } else if (Date.now() - stableSince >= settings.settleMs) {
      ship.data.phase = "review";
      await saveShip(ship);
      return;
    }
    await sleep(settings.pollMs);
  }
}

function parseWorkerJson(text) {
  const raw = String(text || "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
  const source = fenced ? fenced[1] : raw;
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Worker did not return JSON.");
  return JSON.parse(source.slice(first, last + 1));
}

function shipReviewerSystem() {
  return [
    readSkill("dev-review"),
    "",
    "Controller invocation contract:",
    "- No human UI. Return only JSON.",
    '- Schema: {"status":"pass|repairs|blocked","summary":"...","review_focus":["..."],"validation":["..."],"findings":[{"key":"stable.root.cause","title":"...","reason":"...","evidence":["..."],"repair":{"title":"...","goal":"...","requirements":["..."],"checks":["..."]}}]}',
    "- If human feedback is supplied, it must result in repairs or blocked, never pass.",
  ].join("\n");
}

async function runShipReviewer(ctx, project, ship, humanFeedback = "") {
  let invalid = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await runVisibleAgent(ctx, {
      title: humanFeedback ? "Final feedback triage" : "Candidate review",
      role: "review",
      system: shipReviewerSystem(),
      prompt: [
        `Approved spec: ${path.join(project.dir, "spec.md")}`,
        `Project artifacts: ${project.dir}`,
        `Exact candidate: PR #${ship.data.candidate.pr}, HEAD ${ship.data.candidate.head}, base ${ship.data.candidate.base}`,
        humanFeedback ? `Human feedback: ${humanFeedback}` : "",
        invalid ? `Previous response was invalid. Correct only its structure:\n${invalid}` : "",
      ].filter(Boolean).join("\n\n"),
      tools: ["read", "grep", "glob"],
    });
    if (result?.aborted) throw new Error("Reviewer was interrupted; review state was not advanced.");
    if (result.code !== 0) throw new Error(`Reviewer failed: ${result.stderr || result.stdout}`);
    try {
      const review = parseWorkerJson(result.stdout);
      if (!["pass", "repairs", "blocked"].includes(review.status)) throw new Error("invalid status");
      if (!Array.isArray(review.findings)) throw new Error("findings must be an array");
      if (humanFeedback && review.status === "pass") throw new Error("human feedback cannot return pass");
      if (review.status === "repairs" && review.findings.some((finding) => !finding?.key || !finding?.repair?.goal)) throw new Error("repair findings require key and goal");
      return review;
    } catch (error) {
      invalid = `${error instanceof Error ? error.message : String(error)}\n${String(result.stdout).slice(-1800)}`;
    }
  }
  throw new Error(`Reviewer returned invalid structured output twice.\n${invalid}`);
}

function repairedFindingKeys(entries) {
  return new Set(entries.map((entry) => entry.data.source?.finding_key).filter(Boolean));
}

async function persistShipReview(project, loaded, ship, review) {
  const reviewFile = path.join(project.dir, "review.toon");
  if (review.status === "pass") {
    await writeToon(reviewFile, {
      version: 1, status: "pass", head: ship.data.candidate.head, pr: ship.data.candidate.pr,
      summary: review.summary || "", review_focus: review.review_focus || [], validation: review.validation || [],
    });
    return "pass";
  }
  if (review.status === "blocked") {
    await writeToon(reviewFile, {
      version: 1, status: "blocked", head: ship.data.candidate.head, pr: ship.data.candidate.pr,
      summary: review.summary || "", findings: review.findings || [],
    });
    return "blocked";
  }

  const prior = repairedFindingKeys(loaded.entries);
  const repeated = [...new Set(review.findings.map((finding) => finding.key).filter((key) => prior.has(key)))];
  if (repeated.length) {
    await writeToon(reviewFile, {
      version: 1, status: "blocked", head: ship.data.candidate.head, pr: ship.data.candidate.pr,
      summary: `Previously repaired finding recurred: ${repeated.join(", ")}`, findings: review.findings,
    });
    return "blocked";
  }

  const active = loaded.entries.filter((entry) => !supersededIds(loaded.entries).has(entry.data.id));
  let number = Number(nextRepairId(loaded.entries).slice(1));
  const ids = [];
  for (const finding of review.findings) {
    const id = `R${String(number++).padStart(3, "0")}`;
    ids.push(id);
    await writeToon(path.join(project.dir, "repairs", `${id}.toon`), {
      version: 1, id, title: finding.repair.title || finding.title || id,
      depends_on: active.map((entry) => entry.data.id),
      goal: finding.repair.goal,
      requirements: finding.repair.requirements || [finding.reason].filter(Boolean),
      checks: finding.repair.checks || [],
      source: { kind: "candidate_review", finding_key: finding.key, candidate: ship.data.candidate.head, evidence: finding.evidence || [] },
    });
  }
  await writeToon(reviewFile, {
    version: 1, status: "repairs_planned", head: ship.data.candidate.head, pr: ship.data.candidate.pr,
    summary: review.summary || "", findings: review.findings.map((finding) => ({ key: finding.key, title: finding.title, reason: finding.reason })), repairs: ids,
  });
  return "repairs_planned";
}

async function reviewShipCandidate(ctx, project, loaded, ship) {
  await git(ctx.cwd, ["fetch", "origin", ship.data.candidate.base_branch]);
  const currentBase = await git(ctx.cwd, ["rev-parse", `origin/${ship.data.candidate.base_branch}`]);
  if (currentBase !== ship.data.candidate.base) {
    ship.data.verified_head = null;
    ship.data.candidate = null;
    ship.data.approved_head = null;
    ship.data.phase = "prepare";
    await saveShip(ship);
    return;
  }

  const reviewFile = path.join(project.dir, "review.toon");
  let stored = fs.existsSync(reviewFile) ? await decodeToon(reviewFile) : null;
  if (!stored || stored.head !== ship.data.candidate.head || !["pass", "repairs_planned", "blocked"].includes(stored.status)) {
    const generated = await runShipReviewer(ctx, project, ship);
    await persistShipReview(project, loaded, ship, generated);
    stored = await decodeToon(reviewFile);
  }

  if (stored.status === "pass") {
    ship.data.phase = "human";
    await saveShip(ship);
    return;
  }
  if (stored.status === "repairs_planned") {
    if (ship.data.repair_round >= shipSettings().maxRepairRounds) {
      await blockShip(ship, "Automatic repair-round limit reached.", "build");
      return;
    }
    ship.data.repair_round += 1;
    ship.data.verified_head = null;
    ship.data.candidate = null;
    ship.data.approved_head = null;
    ship.data.phase = "build";
    await saveShip(ship);
    return;
  }
  await blockShip(ship, stored.summary || "Reviewer needs a human semantic decision.", "build");
}

function finalizerSystem() {
  return [
    "Return the approved PR's concise human-facing title and Markdown body.",
    "Do not edit files or GitHub. Return only JSON: {\"title\":\"...\",\"body\":\"...\"}.",
  ].join("\n");
}

async function finalizeCandidate(ctx, project, ship) {
  const result = await runVisibleAgent(ctx, {
    title: "PR finalizer", role: "ship",
    system: finalizerSystem(),
    prompt: [
      `Approved spec: ${path.join(project.dir, "spec.md")}`,
      `Review: ${path.join(project.dir, "review.toon")}`,
      `Exact candidate: PR #${ship.data.candidate.pr}, HEAD ${ship.data.candidate.head}`,
    ].join("\n\n"),
    tools: ["read", "grep", "glob"],
  });
  if (result?.aborted) throw new Error("Finalizer was interrupted; approval is preserved.");
  if (result.code !== 0) throw new Error(`Finalizer failed: ${result.stderr || result.stdout}`);
  const draft = parseWorkerJson(result.stdout);
  if (!draft.title || !draft.body) throw new Error("Finalizer must return title and body.");
  await gh(ctx.cwd, ["pr", "edit", String(ship.data.candidate.pr), "--title", String(draft.title), "--body", String(draft.body)]);
  await gh(ctx.cwd, ["pr", "ready", String(ship.data.candidate.pr)]);
}

async function askApproval(ctx, title, preview) {
  if (!ctx.hasUI) throw new Error(`${title} requires interactive OMP.`);
  if (ctx.ui.askDialog) {
    const result = await ctx.ui.askDialog([{
      id: "decision",
      question: title,
      header: "Review",
      options: [
        { label: "Approve", description: "Accept this exact artifact/candidate.", preview },
        { label: "Request changes", description: "Provide feedback and regenerate/review.", preview },
      ],
    }]);
    if (!result || result.kind !== "submit") return { action: "cancel" };
    const answer = result.results?.[0];
    const selected = answer?.selectedOptions?.[0] || "";
    if (selected === "Approve") return { action: "approve" };
    if (selected === "Request changes") {
      const feedback = await ctx.ui.editor("Review feedback", answer?.customInput || "");
      return feedback === undefined ? { action: "cancel" } : { action: "feedback", feedback };
    }
    if (answer?.customInput) return { action: "feedback", feedback: answer.customInput };
    return { action: "cancel" };
  }
  const selected = await ctx.ui.select(title, ["Approve", "Request changes"]);
  if (selected === "Approve") return { action: "approve" };
  if (selected === "Request changes") {
    const feedback = await ctx.ui.editor("Review feedback", "");
    return feedback === undefined ? { action: "cancel" } : { action: "feedback", feedback };
  }
  return { action: "cancel" };
}

function finalReviewPreview(project, review, ship) {
  const candidate = ship.data.candidate;
  return [
    `# ${project.name} ready`,
    "",
    `PR #${candidate.pr} · HEAD ${candidate.head.slice(0, 12)} · repair rounds ${ship.data.repair_round}`,
    "",
    "## Review",
    review.summary || "Machine review passed.",
    "",
    "## Focus",
    (review.review_focus || []).map((item) => `- ${item}`).join("\n") || "- None",
    "",
    "## Validation",
    (review.validation || []).map((item) => `- ${item}`).join("\n") || "- Local and remote gates passed",
  ].join("\n");
}

async function finalHumanReview(ctx, project, loaded, ship) {
  const review = await decodeToon(path.join(project.dir, "review.toon"));
  const candidate = ship.data.candidate;

  if (ship.data.approved_head !== candidate.head) {
    const decision = await askApproval(ctx, `Approve exact candidate PR #${candidate.pr}?`, finalReviewPreview(project, review, ship));
    if (decision.action === "cancel") return;
    if (decision.action === "feedback") {
      const generated = await runShipReviewer(ctx, project, ship, decision.feedback || "");
      const status = await persistShipReview(project, loaded, ship, generated);
      if (status === "repairs_planned") {
        ship.data.repair_round = 0;
        ship.data.verified_head = null;
        ship.data.candidate = null;
        ship.data.phase = "build";
        await saveShip(ship);
        return;
      }
      await blockShip(ship, generated.summary || "Human feedback requires replanning.", "build");
      return;
    }
    ship.data.approved_head = candidate.head;
    await saveShip(ship);
  }

  let pr = await ghJson(ctx.cwd, ["pr", "view", String(candidate.pr), "--json", "isDraft,headRefOid,url"]);
  if (pr.headRefOid !== candidate.head) throw new Error("PR moved while finalizing.");
  if (pr.isDraft) {
    await finalizeCandidate(ctx, project, ship);
    pr = await ghJson(ctx.cwd, ["pr", "view", String(candidate.pr), "--json", "isDraft,headRefOid,url"]);
  }
  if (pr.headRefOid !== candidate.head) throw new Error("PR moved while finalizing.");
  if (pr.isDraft) throw new Error("Finalizer did not mark the PR ready; approval is preserved for retry.");
  ship.data.phase = "done";
  await saveShip(ship);
}

async function driveShip(ctx, args) {
  await ensureIgnored(ctx.cwd);
  const tokens = String(args || "").trim().split(/\s+/).filter(Boolean);
  const resume = tokens.includes("--resume");
  const project = await chooseProject(ctx, tokens.filter((token) => token !== "--resume").join(" "));
  if (!project) return;
  const ship = await loadShip(project);

  if (ship.data.phase === "blocked") {
    if (!resume) {
      ctx.ui.notify(`Shipping blocked: ${ship.data.blocked?.reason || "human decision required"}. Resolve it, then run /dev-ship --resume.`, "warning");
      return;
    }
    ship.data.phase = ship.data.blocked?.resume || "build";
    ship.data.blocked = null;
    await saveShip(ship);
  }

  while (true) {
    const loaded = await loadProject(project);
    ctx.ui.setStatus("dev-ship", `${project.name} · ${ship.data.phase}`);

    if (ship.data.phase === "build") {
      try {
        await driveBuild(ctx, project.name);
      } catch (error) {
        await blockShip(ship, error instanceof Error ? error.message : String(error), "build");
        return;
      }
      await setShipPhase(ship, "prepare");
      continue;
    }
    if (ship.data.phase === "prepare") {
      await prepareShipCandidate(ctx, project, loaded, ship);
      if (ship.data.phase === "blocked") return;
      continue;
    }
    if (ship.data.phase === "await") {
      await awaitShipSignals(ctx, ship);
      if (ship.data.phase === "blocked") return;
      continue;
    }
    if (ship.data.phase === "review") {
      await reviewShipCandidate(ctx, project, loaded, ship);
      if (ship.data.phase === "blocked") return;
      continue;
    }
    if (ship.data.phase === "human") {
      await finalHumanReview(ctx, project, loaded, ship);
      if (ship.data.phase === "human" || ship.data.phase === "blocked") return;
      continue;
    }
    if (ship.data.phase === "done") {
      ctx.ui.notify(`Shipping complete: ${ship.data.candidate?.url || "PR ready"}`, "info");
      return;
    }
    throw new Error(`Unknown shipping phase: ${ship.data.phase}`);
  }
}

async function drivePrepare(ctx, args) {
  await ensureIgnored(ctx.cwd);
  const project = await chooseProject(ctx, args);
  if (!project) return;
  const loaded = await loadProject(project);
  const progress = await loadProgress(project, loaded.data);
  const active = loaded.entries.filter((entry) => !supersededIds(loaded.entries).has(entry.data.id));
  const done = new Set(progress.data.done || []);
  const missing = active.filter((entry) => !done.has(entry.data.id));
  if (missing.length) throw new Error(`Prepare requires all approved work complete: ${missing.map((entry) => entry.data.id).join(", ")}`);
  const ship = await loadShip(project);
  ship.data.phase = "prepare";
  await saveShip(ship);
  await prepareShipCandidate(ctx, project, loaded, ship);
  if (ship.data.phase === "await") ctx.ui.notify(`Draft candidate published: ${ship.data.candidate?.url || "PR"}`, "info");
  else if (ship.data.phase === "build") ctx.ui.notify("Prepare found a final-gate failure and planned a repair.", "warning");
  else if (ship.data.phase === "blocked") ctx.ui.notify(`Prepare blocked: ${ship.data.blocked?.reason || "human decision required"}`, "warning");
}

async function driveManualReview(ctx, args) {
  await ensureIgnored(ctx.cwd);
  const project = await chooseProject(ctx, args);
  if (!project) return;
  const loaded = await loadProject(project);
  const pr = await currentPr(ctx.cwd);
  if (!pr) throw new Error("No pull request is associated with the current branch.");
  const checkResult = await run("gh", ["pr", "checks", String(pr.number), "--json", "name,state,bucket,workflow"], ctx.cwd);
  let checks;
  try { checks = JSON.parse(checkResult.stdout || "[]"); } catch { throw new Error(`Could not parse PR checks: ${checkResult.stderr || checkResult.stdout}`); }
  if (checksPending(checks)) { ctx.ui.notify("Review deferred: PR checks are still pending.", "warning"); return; }

  const baseBranch = pr.baseRefName || loaded.data.base_branch || "main";
  await git(ctx.cwd, ["fetch", "origin", baseBranch]);
  const ship = await loadShip(project);
  ship.data.candidate = {
    head: pr.headRefOid,
    base: await git(ctx.cwd, ["rev-parse", `origin/${baseBranch}`]),
    base_branch: baseBranch,
    pr: pr.number,
    url: pr.url,
    published_at: new Date().toISOString(),
  };
  await saveShip(ship);

  const review = await runShipReviewer(ctx, project, ship);
  if (review.status !== "repairs") {
    await persistShipReview(project, loaded, ship, review);
    ctx.ui.notify(review.status === "pass" ? "Review PASS: no material issue found." : `Review blocked: ${review.summary || "semantic decision required"}`, review.status === "pass" ? "info" : "warning");
    return;
  }

  if (!ctx.hasUI || !ctx.ui.askDialog) throw new Error("Selecting review repairs requires interactive OMP.");
  const labels = review.findings.map((finding) => `${finding.key}: ${finding.title || finding.repair?.title || "repair"}`);
  const answer = await ctx.ui.askDialog([{
    id: "repairs",
    question: "Which review repairs should be approved?",
    header: "Repairs",
    options: review.findings.map((finding, i) => ({ label: labels[i], description: finding.reason || finding.repair?.goal || "" })),
    multi: true,
  }]);
  if (!answer || answer.kind !== "submit") return;
  const selected = new Set(answer.results?.[0]?.selectedOptions || []);
  const filtered = { ...review, findings: review.findings.filter((_finding, i) => selected.has(labels[i])) };
  if (!filtered.findings.length) { ctx.ui.notify("No repairs approved.", "info"); return; }
  await persistShipReview(project, loaded, ship, filtered);
  ctx.ui.notify(`Approved ${filtered.findings.length} repair(s).`, "info");
}

export default function (pi) {
  const invokeSkill = (skill, args) => {
    const suffix = String(args || "").trim();
    pi.sendUserMessage(`/skill:${skill}${suffix ? ` ${suffix}` : ""}`);
  };

  pi.registerCommand("dev-spec", {
    description: "Run the dev-spec skill in the current Specifier session",
    handler: async (args) => invokeSkill("dev-spec", args),
  });
  pi.registerCommand("dev-plan", {
    description: "Run the dev-plan skill in the current Planner session",
    handler: async (args) => invokeSkill("dev-plan", args),
  });
  pi.registerCommand("dev-build", { description: "Deterministically drive fresh Builders through every approved plan/repair", handler: async (args, ctx) => {
    try { await driveBuild(ctx, args); } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); } finally { ctx.ui.setStatus("dev-build", undefined); }
  }});
  pi.registerCommand("dev-prepare", { description: "Deterministically publish the exact draft PR candidate and stop", handler: async (args, ctx) => {
    try { await drivePrepare(ctx, args); } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); } finally { ctx.ui.setStatus("dev-ship", undefined); }
  }});
  pi.registerCommand("dev-review", { description: "Run one direct Reviewer and human-select concrete repairs", handler: async (args, ctx) => {
    try { await driveManualReview(ctx, args); } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
  }});
  pi.registerCommand("dev-ship", { description: "Deterministically drive build-to-ready-PR convergence", handler: async (args, ctx) => {
    try { await driveShip(ctx, args); } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); } finally { ctx.ui.setStatus("dev-ship", undefined); }
  }});
}
