import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Type } from "typebox";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Image, Key, Markdown, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
const CONFIG_PATH = path.join(AGENT_DIR, "dev-workflow.json");
const SKILL_ROOT = process.env.DEV_WORKFLOW_SKILL_ROOT || path.join(os.homedir(), ".agents", "skills");
const PLAN_RE = /^P\d+\.toon$/;
const REPAIR_RE = /^R\d+\.toon$/;

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

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

function roleConfig(role) {
  const cfg = readConfig();
  return cfg.models?.[role] || {};
}

async function resolveModel(ctx, pattern) {
  if (!pattern) return undefined;
  const slash = pattern.indexOf("/");
  if (slash > 0) {
    const exact = ctx.modelRegistry.find(pattern.slice(0, slash), pattern.slice(slash + 1));
    if (exact) return exact;
  }
  const models = await ctx.modelRegistry.getAvailable();
  const p = pattern.toLowerCase();
  let matches = models.filter((m) => `${m.provider}/${m.id}`.toLowerCase() === p || m.id.toLowerCase() === p);
  if (matches.length === 0) matches = models.filter((m) => `${m.provider}/${m.id}`.toLowerCase().includes(p));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`Configured model ${pattern} is unavailable. Run pi --list-models or edit ${CONFIG_PATH}.`);
  throw new Error(`Configured model ${pattern} is ambiguous: ${matches.map((m) => `${m.provider}/${m.id}`).join(", ")}`);
}

async function applyRole(pi, ctx, role) {
  const profile = roleConfig(role);
  if (profile.model) {
    const model = await resolveModel(ctx, profile.model);
    if (!(await pi.setModel(model))) throw new Error(`No usable auth for ${model.provider}/${model.id}`);
  }
  if (profile.thinking) pi.setThinkingLevel(profile.thinking);
}

async function resolvedRoleProfile(ctx, role) {
  const profile = roleConfig(role);
  if (!profile.model) return { ...profile };
  const model = await resolveModel(ctx, profile.model);
  return { ...profile, model: `${model.provider}/${model.id}` };
}

async function launchSkill(pi, ctx, role, skill, args, fresh, invocation = "") {
  const profile = roleConfig(role);
  const file = skillPath(skill);
  if (!fs.existsSync(file)) throw new Error(`Missing installed skill ${file}`);
  const request = args?.trim() ? `\n\nUser request: ${args.trim()}` : "";
  const extra = invocation ? `\n\nInvocation contract:\n${invocation}` : "";
  const prompt = `Read and follow the exact ${skill} skill at ${file}.${extra}${request}`;

  if (!fresh) {
    await applyRole(pi, ctx, role);
    pi.sendUserMessage(prompt);
    return;
  }

  let model;
  if (profile.model) {
    model = await resolveModel(ctx, profile.model);
    if (!(await pi.setModel(model))) throw new Error(`No usable auth for ${model.provider}/${model.id}`);
  }
  if (profile.thinking) pi.setThinkingLevel(profile.thinking);
  const result = await ctx.newSession({
    setup: async (sessionManager) => {
      if (model) sessionManager.appendModelChange(model.provider, model.id);
      if (profile.thinking) sessionManager.appendThinkingLevelChange(profile.thinking);
    },
    withSession: async (replacementCtx) => {
      replacementCtx.ui.notify(`${skill} · ${profile.model || "current model"}/${profile.thinking || "default"}`, "info");
      await replacementCtx.sendUserMessage(prompt);
    },
  });
  if (result?.cancelled) return;
}

function findProjects(cwd) {
  const root = path.join(cwd, "plans");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, "project.toon")))
    .map((e) => ({ name: e.name, dir: path.join(root, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function chooseProject(ctx, arg) {
  const projects = findProjects(ctx.cwd);
  if (arg?.trim()) {
    const raw = arg.trim().split(/\s+/)[0];
    const direct = path.resolve(ctx.cwd, raw);
    if (fs.existsSync(path.join(direct, "project.toon"))) return { name: path.basename(direct), dir: direct };
    const match = projects.find((p) => p.name === raw);
    if (match) return match;
    throw new Error(`Unknown project ${raw}`);
  }
  if (projects.length === 1) return projects[0];
  if (projects.length === 0) throw new Error("No planned project under plans/<project>. Run /dev-spec and /dev-plan first.");
  if (!ctx.hasUI) throw new Error("Multiple projects found; pass a project name.");
  const picked = await ctx.ui.select("Project", projects.map((p) => p.name));
  return projects.find((p) => p.name === picked);
}

async function loadProject(project) {
  const projectFile = path.join(project.dir, "project.toon");
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
  const r = await run("git", ["check-ignore", "-q", "plans"], cwd);
  if (r.code !== 0) throw new Error("plans/ must be Git-ignored before using the workflow.");
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

function summarizeTool(name, args) {
  if (name === "read") return `read ${args?.path || args?.file_path || ""}`.trim();
  if (name === "bash") return `$ ${String(args?.command || "").split("\n")[0].slice(0, 140)}`;
  if (name === "grep") return `grep ${args?.pattern || ""}`.trim();
  if (name === "find") return `find ${args?.pattern || args?.path || ""}`.trim();
  if (name === "edit") return `edit ${args?.path || args?.file_path || ""}`.trim();
  if (name === "write") return `write ${args?.path || args?.file_path || ""}`.trim();
  if (name === "explore") return `explore ${Array.isArray(args?.tasks) ? args.tasks.length : 1} task(s)`;
  return name;
}

function makeTempPrompt(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-workflow-"));
  const file = path.join(dir, "system.md");
  fs.writeFileSync(file, text);
  return { dir, file };
}

function spawnJsonAgent(cwd, profile, systemPrompt, prompt, tools, onEvent, signal, childEnv) {
  return new Promise((resolve) => {
    const tmp = makeTempPrompt(systemPrompt);
    const args = ["--mode", "json", "-p", "--no-session"];
    if (profile.model) args.push("--model", profile.model);
    if (profile.thinking) args.push("--thinking", profile.thinking);
    if (tools?.length) args.push("--tools", tools.join(","));
    args.push("--append-system-prompt", tmp.file, "--", prompt);
    const child = spawn("pi", args, { cwd, env: { ...process.env, ...(childEnv || {}) }, stdio: ["ignore", "pipe", "pipe"] });
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
      setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 3000);
    };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
  });
}

class AgentMonitor {
  constructor(tui, theme, title, subtitle, done) {
    this.tui = tui;
    this.theme = theme;
    this.title = title;
    this.subtitle = subtitle;
    this.done = done;
    this.lines = [];
    this.streaming = "";
    this.usage = {};
    this.result = undefined;
    this.aborted = false;
  }
  push(line) {
    if (!line) return;
    this.lines.push(line.replace(/\s+/g, " ").trim());
    if (this.lines.length > 80) this.lines.splice(0, this.lines.length - 80);
    this.tui.requestRender();
  }
  event(event, state) {
    this.usage = state.usage || this.usage;
    if (event.type === "tool_execution_start") this.push(`● ${summarizeTool(event.toolName, event.args)}`);
    if (event.type === "tool_execution_end") this.push(`${event.isError ? "✗" : "✓"} ${event.toolName}`);
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      this.streaming = `${this.streaming}${event.assistantMessageEvent.delta || ""}`.slice(-1200);
      this.tui.requestRender();
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const text = extractMessageText(event.message);
      if (text) this.push(`assistant: ${text.slice(0, 400)}`);
      this.streaming = "";
    }
  }
  finish(result) {
    this.result = result;
    setTimeout(() => this.done(result), 250);
  }
  render(width) {
    const theme = this.theme;
    const lines = [];
    const usage = this.usage || {};
    const usageText = usage.totalTokens ? `${Math.round(usage.totalTokens / 1000)}k tokens` : "";
    lines.push(theme.fg("accent", theme.bold(` ${this.title} `)) + theme.fg("dim", this.subtitle ? ` ${this.subtitle}` : ""));
    lines.push(theme.fg("dim", "─".repeat(Math.max(1, width - 2))));
    const body = [...this.lines.slice(-22)];
    if (this.streaming.trim()) body.push(`… ${this.streaming.trim().slice(-500)}`);
    for (const raw of body) {
      for (const wrapped of wrapTextWithAnsi(raw, Math.max(20, width - 4))) lines.push(`  ${truncateToWidth(wrapped, width - 2)}`);
    }
    lines.push("");
    lines.push(theme.fg("dim", `${usageText}${usageText ? " · " : ""}Esc/Ctrl-C abort`));
    return lines.map((line) => truncateToWidth(line, width));
  }
  invalidate() {}
  handleInput(data) {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.aborted = true;
      this.done({ abort: true });
    }
  }
}

async function runVisibleAgent(ctx, options) {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    return spawnJsonAgent(ctx.cwd, options.profile, options.system, options.prompt, options.tools, undefined, options.signal, options.env);
  }
  const controller = new AbortController();
  let processPromise;
  const uiResult = await ctx.ui.custom((tui, theme, _kb, done) => {
    const monitor = new AgentMonitor(tui, theme, options.title, options.subtitle || "", done);
    processPromise = spawnJsonAgent(ctx.cwd, options.profile, options.system, options.prompt, options.tools, (event, state) => monitor.event(event, state), controller.signal, options.env)
      .then((result) => { if (!monitor.aborted) monitor.finish(result); return result; });
    return monitor;
  });
  if (uiResult?.abort) controller.abort();
  return processPromise || { code: -1, stdout: "", stderr: "agent did not start", aborted: true };
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
  const cfg = readConfig();
  const max = Math.max(1, Number(cfg.build?.max_attempts_per_plan || 2));
  const plan = entry.data;
  const base = progress.data.head;
  progress.data.current = plan.id;
  await writeToon(progress.file, progress.data);
  let failure = "";

  for (let attempt = 1; attempt <= max; attempt++) {
    const profile = await resolvedRoleProfile(ctx, attempt === 1 ? "builder" : "builder_retry");
    const prompt = [
      `Project spec: ${path.join(project.dir, "spec.md")}`,
      `Execution contract: ${entry.file}`,
      `Accepted predecessor: ${base}`,
      failure ? `Previous attempt evidence:\n${failure}` : "",
    ].filter(Boolean).join("\n\n");
    const result = await runVisibleAgent(ctx, {
      title: `${plan.id} · ${plan.title || "Builder"}`,
      subtitle: `${profile.model || "model"}/${profile.thinking || "default"} · attempt ${attempt}/${max}`,
      profile,
      system: readSkill("dev-implement"),
      prompt,
      tools: ["read", "bash", "edit", "write", "explore"],
      env: { DEV_WORKFLOW_CHILD: "1" },
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
  const ship = readConfig().ship || {};
  return {
    maxRepairRounds: Math.max(0, Number(ship.max_repair_rounds ?? 2)),
    pollMs: Math.max(5000, Number(ship.poll_seconds ?? 20) * 1000),
    settleMs: Math.max(10000, Number(ship.settle_seconds ?? 60) * 1000),
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
  const profile = await resolvedRoleProfile(ctx, "builder_retry");
  const result = await runVisibleAgent(ctx, {
    title: "Rebase conflicts",
    subtitle: `${profile.model || "model"}/${profile.thinking || "default"} · ${conflicts.length} file(s)`,
    profile,
    system: conflictResolverSystem(),
    prompt: [
      `Approved spec: ${path.join(project.dir, "spec.md")}`,
      `Conflicted files:\n${conflicts.map((file) => `- ${file}`).join("\n")}`,
      "Resolve the files and leave Git sequencing to the controller.",
    ].join("\n\n"),
    tools: ["read", "grep", "find", "ls", "edit", "write"],
    env: { DEV_WORKFLOW_CHILD: "1" },
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
    await gh(ctx.cwd, ["pr", "create", "--draft", "--base", baseBranch, "--head", branch, "--title", String(title), "--body", "Draft candidate managed by the Pi dev workflow."]);
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
  const profile = await resolvedRoleProfile(ctx, "review");
  let invalid = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await runVisibleAgent(ctx, {
      title: humanFeedback ? "Final feedback triage" : "Candidate review",
      subtitle: `${profile.model || "model"}/${profile.thinking || "default"}`,
      profile,
      system: shipReviewerSystem(),
      prompt: [
        `Approved spec: ${path.join(project.dir, "spec.md")}`,
        `Project artifacts: ${project.dir}`,
        `Exact candidate: PR #${ship.data.candidate.pr}, HEAD ${ship.data.candidate.head}, base ${ship.data.candidate.base}`,
        humanFeedback ? `Human feedback: ${humanFeedback}` : "",
        invalid ? `Previous response was invalid. Correct only its structure:\n${invalid}` : "",
      ].filter(Boolean).join("\n\n"),
      tools: ["read", "grep", "find", "ls", "explore"],
      env: { DEV_WORKFLOW_CHILD: "1" },
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
  const profile = await resolvedRoleProfile(ctx, "ship");
  const result = await runVisibleAgent(ctx, {
    title: "PR finalizer", subtitle: `${profile.model || "model"}/${profile.thinking || "default"}`, profile,
    system: finalizerSystem(),
    prompt: [
      `Approved spec: ${path.join(project.dir, "spec.md")}`,
      `Review: ${path.join(project.dir, "review.toon")}`,
      `Exact candidate: PR #${ship.data.candidate.pr}, HEAD ${ship.data.candidate.head}`,
    ].join("\n\n"),
    tools: ["read", "grep", "find", "ls"],
    env: { DEV_WORKFLOW_CHILD: "1" },
  });
  if (result?.aborted) throw new Error("Finalizer was interrupted; approval is preserved.");
  if (result.code !== 0) throw new Error(`Finalizer failed: ${result.stderr || result.stdout}`);
  const draft = parseWorkerJson(result.stdout);
  if (!draft.title || !draft.body) throw new Error("Finalizer must return title and body.");
  await gh(ctx.cwd, ["pr", "edit", String(ship.data.candidate.pr), "--title", String(draft.title), "--body", String(draft.body)]);
  await gh(ctx.cwd, ["pr", "ready", String(ship.data.candidate.pr)]);
}

async function finalHumanReview(ctx, project, loaded, ship) {
  const review = await decodeToon(path.join(project.dir, "review.toon"));
  const candidate = ship.data.candidate;
  if (!ctx.hasUI || ctx.mode !== "tui") throw new Error("Final human review requires interactive Pi.");

  if (ship.data.approved_head !== candidate.head) {
    const decision = await ctx.ui.custom((tui, theme, _kb, done) => new RichBriefView(tui, theme, {
      mode: "review", title: `${project.name} ready`, subtitle: `PR #${candidate.pr} · ${candidate.head.slice(0, 12)}`,
      metrics: [{ label: "Repair rounds", value: String(ship.data.repair_round) }],
      sections: [
        { label: "Review", markdown: review.summary || "Machine review passed." },
        { label: "Focus", markdown: (review.review_focus || []).map((item) => `- ${item}`).join("\n") || "No additional focus." },
        { label: "Validation", markdown: (review.validation || []).map((item) => `- ${item}`).join("\n") || "Local and remote gates passed." },
      ], repairs: [],
    }, done));
    if (!decision || decision.action === "cancel") return;
    if (decision.action === "feedback") {
      const feedback = await ctx.ui.editor("Final review feedback", "");
      const generated = await runShipReviewer(ctx, project, ship, feedback || "");
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

class RichBriefView {
  constructor(tui, theme, params, done) {
    this.tui = tui;
    this.theme = theme;
    this.params = params;
    this.done = done;
    this.sections = Array.isArray(params.sections) && params.sections.length ? params.sections : [{ label: "Overview", markdown: params.summary || "" }];
    this.repairs = Array.isArray(params.repairs) ? params.repairs : [];
    this.tabs = [...this.sections.map((s, i) => ({ kind: "section", label: s.label || `Section ${i + 1}`, index: i }))];
    if (this.repairs.length) this.tabs.push({ kind: "repairs", label: `Repairs (${this.repairs.length})`, index: 0 });
    this.tab = 0;
    this.repairCursor = 0;
    this.selected = new Set(this.repairs.filter((r) => r.selected !== false).map((r) => r.id));
    this.sidebarWidth = 24;
  }
  current() { return this.tabs[this.tab] || this.tabs[0]; }
  finish(action) { this.done({ action, selectedRepairIds: [...this.selected] }); }
  renderContent(width) {
    const theme = this.theme;
    const tab = this.current();
    if (tab.kind === "repairs") {
      const lines = [theme.fg("accent", theme.bold("Proposed repairs")), ""];
      this.repairs.forEach((r, i) => {
        const active = i === this.repairCursor;
        const checked = this.selected.has(r.id) ? "☑" : "☐";
        const severity = r.severity ? ` ${String(r.severity).toUpperCase()}` : "";
        const prefix = active ? theme.fg("accent", "›") : " ";
        lines.push(`${prefix} ${checked} ${theme.bold(`${r.id} ${r.title || ""}`)}${theme.fg(r.severity === "critical" ? "error" : r.severity === "important" ? "warning" : "muted", severity)}`);
      });
      const activeRepair = this.repairs[this.repairCursor];
      if (activeRepair) {
        lines.push("", theme.fg("dim", "─".repeat(Math.max(1, Math.min(width, 72)))));
        lines.push(theme.fg("accent", theme.bold(`${activeRepair.id} · ${activeRepair.title || "Repair details"}`)));
        const text = [activeRepair.summary, activeRepair.detail].filter(Boolean).join("\n\n");
        const md = new Markdown(text || "", 0, 0, getMarkdownTheme());
        lines.push(...md.render(Math.max(20, width)));
        if (activeRepair.evidence?.length) {
          lines.push("", theme.fg("accent", theme.bold("Evidence")));
          lines.push(...activeRepair.evidence.map((e) => theme.fg("dim", `• ${e}`)));
        }
      }
      return lines;
    }
    const section = this.sections[tab.index] || {};
    const lines = [];
    if (section.markdown) {
      const md = new Markdown(section.markdown, 0, 0, getMarkdownTheme());
      lines.push(...md.render(Math.max(20, width)));
    }
    if (section.diagram) {
      lines.push("", theme.fg("accent", theme.bold("Diagram")));
      const diagram = String(section.diagram).trim();
      const isMermaid = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|mindmap|timeline|quadrantChart)\b/m.test(diagram);
      if (isMermaid) {
        const md = new Markdown(`\`\`\`mermaid\n${diagram}\n\`\`\``, 0, 0, getMarkdownTheme());
        lines.push(...md.render(Math.max(20, width)));
      } else {
        for (const raw of diagram.split("\n")) lines.push(theme.fg("muted", raw));
      }
    }
    if (section.code) {
      lines.push("", theme.fg("accent", theme.bold("Code / data")));
      const language = String(section.code_language || "text").replace(/[^a-zA-Z0-9_+.#-]/g, "");
      const md = new Markdown(`\`\`\`${language}\n${String(section.code)}\n\`\`\``, 0, 0, getMarkdownTheme());
      lines.push(...md.render(Math.max(20, width)));
    }
    if (Array.isArray(section.links) && section.links.length) {
      lines.push("", theme.fg("accent", theme.bold("Evidence / links")));
      const mdText = section.links.map((link) => `- [${String(link.label).replace(/[\[\]]/g, "")}](${String(link.url)})`).join("\n");
      const md = new Markdown(mdText, 0, 0, getMarkdownTheme());
      lines.push(...md.render(Math.max(20, width)));
    }
    if (section.image_path && fs.existsSync(section.image_path)) {
      try {
        const ext = path.extname(section.image_path).toLowerCase();
        const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
        const img = new Image(fs.readFileSync(section.image_path).toString("base64"), mime, { fallbackColor: (value) => this.theme.fg("dim", value) }, { maxWidthCells: Math.max(20, width), maxHeightCells: 26, filename: path.basename(section.image_path) });
        lines.push("", ...img.render(Math.max(20, width)));
      } catch {
        lines.push(theme.fg("warning", `[image unavailable: ${section.image_path}]`));
      }
    }
    return lines.length ? lines : [theme.fg("muted", "No content")];
  }
  render(width) {
    const theme = this.theme;
    const lines = [];
    const mode = String(this.params.mode || "brief").toUpperCase();
    lines.push(theme.bg("customMessageBg", theme.fg("accent", theme.bold(` ${mode} · ${this.params.title || "Review"} `))));
    if (this.params.subtitle) lines.push(theme.fg("muted", ` ${this.params.subtitle}`));
    if (Array.isArray(this.params.metrics) && this.params.metrics.length) {
      const metricLine = this.params.metrics.map((m) => `${theme.fg("dim", m.label)} ${theme.bold(String(m.value))}`).join(theme.fg("dim", "   ·   "));
      lines.push(` ${truncateToWidth(metricLine, Math.max(1, width - 2))}`);
    }
    lines.push(theme.fg("dim", "─".repeat(Math.max(1, width))));

    const wide = width >= 92;
    const sideWidth = wide ? Math.min(this.sidebarWidth, Math.max(20, Math.floor(width * 0.24))) : width;
    const mainWidth = wide ? Math.max(30, width - sideWidth - 3) : width;
    const sidebar = this.tabs.map((t, i) => `${i === this.tab ? theme.fg("accent", "●") : theme.fg("dim", "○")} ${t.label}`);
    const content = this.renderContent(mainWidth - 2);
    this.lastWide = wide;
    this.lastSideWidth = sideWidth;
    this.bodyStart = lines.length;
    this.repairListStart = this.bodyStart + 2;

    if (wide) {
      const rows = Math.max(sidebar.length + 2, content.length);
      for (let i = 0; i < rows; i++) {
        const left = i < sidebar.length ? ` ${sidebar[i]}` : "";
        const right = i < content.length ? content[i] : "";
        lines.push(`${truncateToWidth(left, sideWidth, "").padEnd(sideWidth)} ${theme.fg("dim", "│")} ${truncateToWidth(right, mainWidth)}`);
      }
    } else {
      lines.push(` ${this.tabs.map((t, i) => i === this.tab ? theme.fg("accent", `[${t.label}]`) : t.label).join("  ")}`);
      lines.push(theme.fg("dim", "─".repeat(Math.max(1, width))));
      lines.push(...content.map((l) => truncateToWidth(l, width)));
    }
    lines.push("", theme.fg("dim", "←→/Tab sections · ↑↓ repairs · Space toggle · A approve · F feedback · Esc cancel · mouse/wheel supported in fullscreen"));
    return lines.map((line) => truncateToWidth(line, width));
  }
  invalidate() {}
  handleInput(data) {
    const tab = this.current();
    if (matchesKey(data, Key.left) || matchesKey(data, Key.shift("tab"))) this.tab = (this.tab - 1 + this.tabs.length) % this.tabs.length;
    else if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) this.tab = (this.tab + 1) % this.tabs.length;
    else if (tab?.kind === "repairs" && (matchesKey(data, Key.up) || data === "k")) this.repairCursor = Math.max(0, this.repairCursor - 1);
    else if (tab?.kind === "repairs" && (matchesKey(data, Key.down) || data === "j")) this.repairCursor = Math.min(this.repairs.length - 1, this.repairCursor + 1);
    else if (tab?.kind === "repairs" && (matchesKey(data, Key.space) || data === "x")) {
      const id = this.repairs[this.repairCursor]?.id;
      if (id) this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
    } else if (data.toLowerCase?.() === "a") this.finish("approve");
    else if (data.toLowerCase?.() === "f") this.finish("feedback");
    else if (matchesKey(data, Key.escape) || data.toLowerCase?.() === "q") this.finish("cancel");
    this.tui.requestRender();
  }
  handleMouse(event) {
    // Leave wheel events unhandled so Pi's fullscreen ScrollView provides natural page scrolling.
    if (event.type === "wheel") return undefined;
    if (event.type !== "click" || event.button !== "left") return undefined;
    if (this.lastWide && event.y >= this.bodyStart && event.y < this.bodyStart + this.tabs.length && event.x < this.lastSideWidth + 2) {
      this.tab = event.y - this.bodyStart;
      return { handled: true, render: true, focus: true };
    }
    if (this.current()?.kind === "repairs" && this.lastWide && event.x > this.lastSideWidth + 2) {
      const index = event.y - this.repairListStart;
      if (index >= 0 && this.repairs[index]) {
        this.repairCursor = index;
        const id = this.repairs[index].id;
        this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
        return { handled: true, render: true, focus: true };
      }
    }
    return { handled: true, focus: true };
  }
}

const briefSchema = Type.Object({
  mode: Type.Union([Type.Literal("spec"), Type.Literal("plan"), Type.Literal("review")]),
  title: Type.String(),
  subtitle: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  metrics: Type.Optional(Type.Array(Type.Object({ label: Type.String(), value: Type.String() }))),
  sections: Type.Array(Type.Object({
    label: Type.String(),
    markdown: Type.Optional(Type.String()),
    diagram: Type.Optional(Type.String()),
    code: Type.Optional(Type.String()),
    code_language: Type.Optional(Type.String()),
    links: Type.Optional(Type.Array(Type.Object({ label: Type.String(), url: Type.String() }))),
    image_path: Type.Optional(Type.String()),
  })),
  repairs: Type.Optional(Type.Array(Type.Object({
    id: Type.String(),
    title: Type.String(),
    severity: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    detail: Type.Optional(Type.String()),
    evidence: Type.Optional(Type.Array(Type.String())),
    selected: Type.Optional(Type.Boolean()),
  }))),
});

function explorerSystem(capability) {
  return [
    "Answer only the assigned narrow question; read-only.",
    capability === "external" ? "External read-only gh/curl/git is allowed." : "Stay within repository inspection.",
    "Return: Conclusion; Evidence; Uncertainty.",
  ].join("\n");
}

async function runExplorerTask(ctx, task, index, signal, update) {
  const profile = await resolvedRoleProfile(ctx, "explorer");
  const state = { label: task.label || `Explorer ${index + 1}`, model: profile.model || "current", thinking: profile.thinking || "default", status: "running", activity: "starting", output: "", usage: {} };
  update(state, index);
  const tools = task.capability === "external" ? ["read", "grep", "find", "ls", "bash"] : ["read", "grep", "find", "ls"];
  const result = await spawnJsonAgent(ctx.cwd, profile, explorerSystem(task.capability || "repo"), task.task, tools, (event, live) => {
    state.usage = live.usage || state.usage;
    if (event.type === "tool_execution_start") state.activity = summarizeTool(event.toolName, event.args);
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") state.activity = `thinking… ${String(event.assistantMessageEvent.delta || "").trim().slice(-90)}`;
    update(state, index);
  }, signal, { DEV_WORKFLOW_EXPLORER: "1" });
  state.status = result.code === 0 ? "done" : result.aborted ? "aborted" : "failed";
  state.output = String(result.stdout || result.stderr || "").slice(-Number(readConfig().explorer?.max_output_chars || 7000));
  state.activity = state.status;
  update(state, index);
  return state;
}

function registerExploreTool(pi) {
  pi.registerTool({
    name: "explore",
    label: "Explorer",
    description: "Delegate narrow read-only repo, CI/PR, or external-reference research to fresh cheap subagents. Prefer several focused tasks in parallel; the parent receives compact evidence packets, not transcripts.",
    parameters: Type.Object({
      tasks: Type.Array(Type.Object({
        label: Type.String(),
        task: Type.String(),
        capability: Type.Optional(Type.Union([Type.Literal("repo"), Type.Literal("external")])),
      }), { minItems: 1, maxItems: 8 }),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const tasks = params.tasks || [];
      const maxParallel = Math.max(1, Math.min(8, Number(readConfig().explorer?.max_parallel || 4)));
      const explorerProfile = roleConfig("explorer");
      const states = tasks.map((t, i) => ({ label: t.label || `Explorer ${i + 1}`, model: explorerProfile.model || "current", thinking: explorerProfile.thinking || "default", status: "queued", activity: "queued", output: "", usage: {} }));
      const publish = () => {
        const lines = states.map((s) => `${s.status === "done" ? "✓" : s.status === "running" ? "●" : s.status === "failed" ? "✗" : "○"} ${s.label} · ${s.model}/${s.thinking} — ${s.activity}`);
        if (ctx.hasUI) ctx.ui.setWidget("dev-explorers", lines.slice(0, 8));
        onUpdate?.({ content: [{ type: "text", text: `${states.filter((s) => s.status === "done").length}/${states.length} explorer tasks done` }], details: { states } });
      };
      const update = (state, index) => { states[index] = { ...state }; publish(); };
      let cursor = 0;
      async function worker() {
        while (cursor < tasks.length) {
          const index = cursor++;
          states[index].status = "running";
          publish();
          await runExplorerTask(ctx, tasks[index], index, signal, update);
        }
      }
      await Promise.all(Array.from({ length: Math.min(maxParallel, tasks.length) }, () => worker()));
      if (ctx.hasUI) ctx.ui.setWidget("dev-explorers", undefined);
      const text = states.map((s) => `## ${s.label}\n${s.output || `(${s.status})`}`).join("\n\n");
      return { content: [{ type: "text", text }], details: { states } };
    },
    renderCall(args, theme) {
      return { render: (w) => [truncateToWidth(theme.fg("accent", `Explorer · ${args.tasks?.length || 0} focused task(s)`), w)], invalidate() {} };
    },
    renderResult(result, { isPartial }, theme) {
      const states = result.details?.states || [];
      const lines = [theme.fg("accent", isPartial ? "Explorers running" : "Explorer evidence")];
      for (const s of states) lines.push(`${s.status === "done" ? theme.fg("success", "✓") : s.status === "failed" ? theme.fg("error", "✗") : theme.fg("accent", "●")} ${s.label} ${theme.fg("dim", `${s.model || ""}/${s.thinking || ""} · ${s.activity || ""}`)}`);
      return { render: (w) => lines.map((l) => truncateToWidth(l, w)), invalidate() {} };
    },
  });
}

function registerExplorerReadOnlyGuard(pi) {
  if (process.env.DEV_WORKFLOW_EXPLORER !== "1") return;
  pi.on("tool_call", async (event) => {
    if (event.toolName === "edit" || event.toolName === "write") {
      return { block: true, reason: "Explorer is read-only." };
    }
    if (event.toolName !== "bash") return undefined;
    const command = String(event.input?.command || "");
    const mutating = [
      /(^|[;&|]\s*)\s*(rm|mv|cp|install|mkdir|touch|truncate)\b/i,
      /\b(sed|perl)\s+[^\n]*(?:-i|--in-place)\b/i,
      /(^|[;&|]\s*)\s*git\s+(add|commit|checkout|switch|reset|clean|rebase|merge|push|pull|stash|cherry-pick|revert|tag)\b/i,
      /(^|[;&|]\s*)\s*gh\s+(pr|issue|release)\s+(create|edit|close|reopen|merge|comment|review|delete)\b/i,
      /\bgh\s+api\b[^\n]*(?:-X|--method)\s*(POST|PUT|PATCH|DELETE)\b/i,
      /\bcurl\b[^\n]*(?:-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i,
      /\bcurl\b[^\n]*(?:-d|--data(?:-raw|-binary|-urlencode)?|-F|--form|-T|--upload-file)\b/i,
      /(^|[^<])>{1,2}(?!>)/,
      /\btee\b/i,
      /\bsudo\b/i,
    ].some((pattern) => pattern.test(command));
    if (mutating) return { block: true, reason: "Explorer bash is restricted to read-only investigation." };
    return undefined;
  });
}

export default function (pi) {
  registerExplorerReadOnlyGuard(pi);
  if (process.env.DEV_WORKFLOW_EXPLORER === "1") return;
  registerExploreTool(pi);

  pi.registerTool({
    name: "workflow_brief",
    label: "Workflow Brief",
    description: "Render the mandatory rich human review surface for spec, plan, or project review. Use this instead of plain prose approval. Supports tabs, Markdown, diagrams, optional terminal images, keyboard/mouse interaction, and selectable repair proposals.",
    parameters: briefSchema,
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI || ctx.mode !== "tui") return { content: [{ type: "text", text: "ERROR: workflow_brief requires interactive Pi TUI." }], details: { action: "unavailable" }, isError: true };
      const result = await ctx.ui.custom((tui, theme, _kb, done) => new RichBriefView(tui, theme, params, done));
      if (!result || result.action === "cancel") return { content: [{ type: "text", text: JSON.stringify({ action: "cancel" }) }], details: result || { action: "cancel" } };
      let feedback;
      if (result.action === "feedback") feedback = await ctx.ui.editor("Review feedback", "");
      const response = { action: result.action, selectedRepairIds: result.selectedRepairIds || [], feedback: feedback || "" };
      return { content: [{ type: "text", text: JSON.stringify(response) }], details: response };
    },
  });

  if (process.env.DEV_WORKFLOW_CHILD === "1") return;

  pi.registerCommand("dev-spec", {
    description: "Define and approve project semantics with a rich Pi brief",
    handler: async (args, ctx) => launchSkill(pi, ctx, "spec", "dev-spec", args, false),
  });
  pi.registerCommand("dev-plan", {
    description: "Compile the approved spec into small plans and approve them in rich Pi UI",
    handler: async (args, ctx) => launchSkill(pi, ctx, "plan", "dev-plan", args, true),
  });
  pi.registerCommand("dev-build", {
    description: "Drive fresh visible Builders through every approved plan/repair",
    handler: async (args, ctx) => {
      try { await driveBuild(ctx, args); }
      catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
      finally { ctx.ui.setStatus("dev-build", undefined); }
    },
  });
  pi.registerCommand("dev-prepare", {
    description: "Prepare, push, and open/update the draft PR so CI/bots can run; do not wait",
    handler: async (args, ctx) => launchSkill(pi, ctx, "prepare", "dev-prepare", args, true),
  });
  pi.registerCommand("dev-review", {
    description: "Synthesize completed CI + bot/PR signals, adversarial review, and human-approved narrow repairs",
    handler: async (args, ctx) => launchSkill(pi, ctx, "review", "dev-review", args, true, [
      "This is the manual review command.",
      "Present one workflow_brief with candidate summary, architecture/behavior impact, CI + PR/bot signals, validation, risks, conclusion, and repair proposals if needed.",
      "If clean, only explicit human approval writes review.toon status pass bound to exact HEAD/PR.",
      "For repairs, let the human inspect, deselect/filter, or give feedback; only selected explicit approvals become new immutable repairs/RNNN.toon IDs, then write review.toon status repairs_approved.",
      "Never reuse a repair ID.",
    ].join("\n")),
  });
  pi.registerCommand("dev-ship", {
    description: "Drive the robust build-to-ready-PR shipping loop",
    handler: async (args, ctx) => {
      try { await driveShip(ctx, args); }
      catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
      finally { ctx.ui.setStatus("dev-ship", undefined); }
    },
  });
}
