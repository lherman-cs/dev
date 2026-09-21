import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { read, save, git, clean, command, ghJSON, contracts, checks, build } from "./workflow.ts";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const blocked = message => Object.assign(new Error(message), { blocked: true });
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const readTools = ["read", "grep", "find", "ls"];
const findingKey = task => typeof task.source === "string" ? task.source : task.source?.finding_key;
const specPath = project => path.join(project.dir, "spec.md");
const finalChecks = project => {
  const declared = contracts(project).meta.final_checks;
  return declared?.length ? declared : ["Justfile", "justfile"].some(f => fs.existsSync(path.join(project.root, f))) ? ["just check", "just test"] : [];
};
const progressPath = project => path.join(project.dir, "progress.toon");
function requireComplete(project) {
  const state = fs.existsSync(progressPath(project)) ? read(progressPath(project)) : { done: [] };
  if (state.current || contracts(project).tasks.some(t => !state.done?.includes(t.id))) throw new Error("Prepare does not start implementation. Run /dev-build for the unfinished contracts first.");
  return state;
}

const reviewSchema = {
  type: "object", additionalProperties: false, required: ["verdict", "summary", "review_focus", "validation", "repairs"],
  properties: {
    verdict: { enum: ["pass", "repairs", "blocked"] }, summary: { type: "string" },
    review_focus: { type: "array", items: { type: "string" } }, validation: { type: "array", items: { type: "string" } },
    repairs: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["key", "title", "goal", "reason", "evidence", "requirements", "checks"], properties: {
        key: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 }, goal: { type: "string", minLength: 1 }, reason: { type: "string", minLength: 1 },
        evidence: { type: "array", items: { type: "string" } }, requirements: { type: "array", items: { type: "string" } },
        checks: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } }
      } } }
  }
};

// All durable state remains the original small TOON checkpoint, not model history.
function loadShip(project) {
  const file = path.join(project.dir, "ship.toon");
  const state = fs.existsSync(file) ? read(file) : { version: 1, phase: "build", repair_round: 0, verified_head: null, candidate: null, approved_head: null, last_failure: null, blocked: null };
  if (!["build", "prepare", "await", "review", "human", "blocked", "done"].includes(state.phase)) throw new Error("Unknown shipping checkpoint; preserve it and reconcile explicitly.");
  return { state, persist: () => save(file, state) };
}
async function rebaseActive(h) {
  const dir = await git(h, "rev-parse", "--path-format=absolute", "--git-dir");
  return ["rebase-merge", "rebase-apply"].some(name => fs.existsSync(path.join(dir, name)));
}
async function finishRebase(h, project) {
  while (await rebaseActive(h)) {
    h.checkpoint?.("Resolving rebase conflicts");
    const files = (await git(h, "diff", "--name-only", "--diff-filter=U")).split("\n").filter(Boolean);
    if (files.length) {
      const result = await h.delegate("build_retry", `Approved spec: ${specPath(project)}\nConflicted files:\n${files.join("\n")}`, undefined, undefined, {
        metadata: { label: "Builder · Resolve rebase conflicts", task: files.join("\n"), kind: "conflicts" },
        tools: [...readTools, "edit", "write"],
        system: "Resolve only these rebase-conflicted files, preserving the approved spec and each commit's intent. Do not sequence Git. Return NEEDS_HUMAN with evidence for a new semantic decision.",
      });
      if (/\bNEEDS_HUMAN\b/.test(result)) throw blocked(result);
      const changed = (await git(h, "diff", "--name-only")).split("\n").filter(Boolean);
      if (changed.some(file => !files.includes(file)) || await git(h, "ls-files", "--others", "--exclude-standard")) throw new Error("Conflict worker changed files outside the assigned conflicts; work preserved.");
      await git(h, "add", "--", ...files);
    }
    const result = await h.exec("env", ["GIT_EDITOR=true", "git", "rebase", "--continue"]);
    if (result.code && !(await git(h, "diff", "--name-only", "--diff-filter=U"))) throw new Error(`Rebase stopped: ${result.stderr || result.stdout}`);
  }
}

async function currentPR(h) {
  return ghJSON(h, ["pr", "view", "--json", "id,number,url,isDraft,state,headRefOid,baseRefOid,baseRefName"]);
}
async function unchanged(h, expected) {
  const pr = await currentPR(h);
  if (pr.state !== "OPEN" || pr.number !== expected.pr || pr.headRefOid !== expected.head || pr.baseRefOid !== expected.base || await git(h, "rev-parse", "HEAD") !== expected.head || !await clean(h)) throw new Error("Candidate or base changed; old verification/approval is not reusable.");
  return pr;
}
async function prepare(h, project, ship) {
  h.checkpoint?.("Preparing exact candidate");
  const { state, persist } = ship;
  const progress = requireComplete(project);
  const baseBranch = contracts(project).meta.base_branch || "main";
  const rebasing = await rebaseActive(h);
  let branch = await git(h, "branch", "--show-current");
  if (rebasing && !branch) {
    const dir = await git(h, "rev-parse", "--path-format=absolute", "--git-dir");
    const file = ["rebase-merge", "rebase-apply"].map(name => path.join(dir, name, "head-name")).find(f => fs.existsSync(f));
    branch = file ? fs.readFileSync(file, "utf8").trim().replace(/^refs\/heads\//, "") : "";
  }
  if (!branch || branch === baseBranch) throw new Error("Prepare requires the human's feature branch/worktree, not the base branch.");
  if (rebasing) {
    h.report("Preparation: resuming the interrupted rebase.");
    await finishRebase(h, project);
  } else {
    if (!await clean(h)) throw new Error("Prepare requires a clean worktree; unrelated work is preserved.");
    h.report(`Preparation: fetching and rebasing onto origin/${baseBranch}.`);
    await git(h, "fetch", "origin", baseBranch);
    const target = await git(h, "rev-parse", `origin/${baseBranch}`);
    // Persist before rebase so an interrupted rebase can be continued by code.
    state.phase = "prepare"; state.rebase_base = target; persist();
    const result = await h.exec("git", ["rebase", target]);
    if (result.code) {
      if (!await rebaseActive(h)) throw new Error(`Rebase failed: ${result.stderr || result.stdout}`);
      await finishRebase(h, project);
    }
  }
  const head = await git(h, "rev-parse", "HEAD");
  progress.head = head; save(progressPath(project), progress);
  const gates = finalChecks(project);
  if (gates.length) h.report(`Preparation: running ${gates.length} final validation ${gates.length === 1 ? "check" : "checks"}.`);
  for (const line of gates) {
    h.checkpoint?.(`Final check: ${line}`);
    h.report(`Validating: ${line}`);
    const result = await h.exec("bash", ["-c", line]);
    if (result.code) {
      const error = new Error(`Final gate failed: ${line}\n${(result.stderr || result.stdout).slice(-1600)}`);
      error.gate = line; error.evidence = (result.stderr || result.stdout).slice(-1600); throw error;
    }
  }
  if (!await clean(h) || await git(h, "rev-parse", "HEAD") !== head) throw new Error("Final gates modified the candidate; refusing to publish.");
  state.verified_head = head; state.validation = gates; persist();
  h.checkpoint?.("Before publishing verified candidate");
  h.report(`Preparation: publishing verified candidate ${head.slice(0, 12)}.`);
  await git(h, "push", "--force-with-lease", "--set-upstream", "origin", `HEAD:refs/heads/${branch}`);
  const prs = await ghJSON(h, ["pr", "list", "--head", branch, "--state", "open", "--json", "number,baseRefName,isDraft"]);
  if (prs.length > 1) throw new Error("Multiple open PRs for this branch.");
  if (!prs.length) await command(h, "gh", ["pr", "create", "--draft", "--base", baseBranch, "--head", branch, "--title", "chore: prepare review candidate", "--body", "Draft candidate. Final summary follows independent and human review."]);
  else {
    if (prs[0].baseRefName !== baseBranch) throw new Error("Existing PR targets a different base branch.");
    if (!prs[0].isDraft) await command(h, "gh", ["pr", "ready", String(prs[0].number), "--undo"]);
  }
  const pr = await currentPR(h);
  const base = await git(h, "rev-parse", `origin/${baseBranch}`);
  if (pr.headRefOid !== head || pr.baseRefOid !== base || !pr.isDraft) throw new Error("Published PR does not match the verified draft candidate.");
  state.candidate = { head, base, base_branch: baseBranch, pr: pr.number, id: pr.id, url: pr.url };
  state.phase = "await"; state.approved_head = null; state.feedback = null; persist();
}

async function signals(h, c) {
  await unchanged(h, c);
  const data = await ghJSON(h, ["pr", "view", String(c.pr), "--json", "headRefOid,baseRefOid,statusCheckRollup,comments,reviews,updatedAt"]);
  if (data.headRefOid !== c.head || data.baseRefOid !== c.base || !Array.isArray(data.statusCheckRollup)) throw new Error("Cannot verify exact-candidate CI signals.");
  let pending = false, red = false;
  for (const check of data.statusCheckRollup) {
    if (check.__typename === "CheckRun" || check.status) {
      if (check.status !== "COMPLETED") pending = true;
      else if (!["SUCCESS", "NEUTRAL", "SKIPPED"].includes(check.conclusion)) red = true;
    } else {
      if (!["SUCCESS", "FAILURE", "ERROR"].includes(check.state)) pending = true;
      else if (check.state !== "SUCCESS") red = true;
    }
  }
  if ((data.reviews || []).some(review => review.state === "PENDING")) pending = true;
  return { ...data, pending, red };
}
async function settled(h, c) {
  let previous, since = 0, status;
  while (true) {
    h.signal?.throwIfAborted();
    h.checkpoint?.();
    const data = await signals(h, c);
    const signature = digest(data);
    const now = h.now ? h.now() : Date.now();
    if (data.pending) {
      previous = undefined; since = 0;
      if (status !== "pending") h.report(`Awaiting CI and review signals for PR #${c.pr}.`);
      status = "pending";
    } else if (signature !== previous) {
      previous = signature; since = now;
      h.report(`${status === "quiet" ? "New feedback detected. Restarting" : "Signals are complete. Starting"} the 60-second quiet period.`);
      status = "quiet";
    } else if (now - since >= 60_000) {
      h.report(`PR #${c.pr} signals settled. Starting independent review.`);
      return data;
    }
    await (h.sleep ? h.sleep(10_000) : delay(10_000, undefined, { signal: h.signal }));
  }
}
async function threads(h, c) {
  const id = c.id || (await currentPR(h)).id;
  const result = [];
  let cursor = null;
  do {
    const query = "query($id:ID!,$cursor:String){node(id:$id){...on PullRequest{reviewThreads(first:100,after:$cursor){nodes{id isResolved isOutdated comments(first:100){nodes{body path line url author{login}} pageInfo{hasNextPage}}} pageInfo{hasNextPage endCursor}}}}}";
    const args = ["api", "graphql", "-f", `query=${query}`, "-f", `id=${id}`];
    if (cursor) args.push("-f", `cursor=${cursor}`);
    const response = await ghJSON(h, args);
    const page = response.data?.node?.reviewThreads;
    if (response.errors?.length || !page) throw new Error("Cannot read complete PR review threads.");
    if (page.nodes.some(thread => thread.comments.pageInfo.hasNextPage)) throw new Error("Review thread exceeds fetched evidence; inspect the full thread before reviewing.");
    result.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (page.pageInfo.hasNextPage && !cursor) throw new Error("Invalid review-thread pagination.");
  } while (cursor);
  return result;
}
async function evidence(h, project, c) {
  const data = await signals(h, c);
  if (data.pending) throw new Error("CI or review feedback is still pending.");
  const { updatedAt, ...stable } = data;
  const feedback = await threads(h, c);
  const diff = await git(h, "diff", `${c.base}...${c.head}`);
  const history = await git(h, "log", "--format=%h %s", `${c.base}..${c.head}`);
  const failures = [];
  for (const check of data.statusCheckRollup) {
    if (check.status === "COMPLETED" && !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(check.conclusion)) {
      const job = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(check.detailsUrl || "");
      if (job) {
        const logs = await h.exec("gh", ["run", "view", "--job", job[1], "--log-failed"]);
        failures.push({ name: check.name, logs: (logs.stdout || logs.stderr).slice(-12000) });
      }
    }
  }
  const approved = [fs.readFileSync(specPath(project), "utf8"), contracts(project).meta, contracts(project).all];
  const checkpointFile = path.join(project.dir, "ship.toon");
  const verifiedHead = fs.existsSync(checkpointFile) ? read(checkpointFile).verified_head : null;
  return { signature: digest({ stable, feedback, approved }), red: data.red, data: { ...stable, threads: feedback, failures, diff, history,
    local_validation: { commands: finalChecks(project), verified: verifiedHead === c.head, verified_head: verifiedHead } } };
}
async function review(h, project, c, feedback = "") {
  h.checkpoint?.("Independent candidate review");
  const before = await evidence(h, project, c);
  const result = await h.delegate("review", `Approved spec: ${specPath(project)}\nPlans/repairs: ${project.dir}\nCandidate: ${JSON.stringify(c)}\nEvidence: ${JSON.stringify(before.data)}${feedback ? `\nHuman feedback: ${feedback}\nThis invocation must return repairs or blocked, never pass.` : ""}`,
    "dev-review", reviewSchema, { tools: readTools, metadata: { label: `Reviewer · Candidate ${c.head.slice(0, 12)}`, task: `Review PR #${c.pr} against approved spec and checks`, candidate: c.head } });
  if (!["pass", "repairs", "blocked"].includes(result.verdict) || !Array.isArray(result.repairs)) throw new Error("Invalid review result.");
  if (feedback && result.verdict === "pass") throw new Error("Human feedback may not be silently passed.");
  if (result.verdict === "pass" && result.repairs.length) throw new Error("PASS cannot contain unaddressed repairs.");
  if (result.verdict === "repairs" && (!result.repairs.length || result.repairs.some(r => !nonempty(r.key) || !nonempty(r.goal) || !r.checks?.length))) throw new Error("Repairs require stable keys, scope and acceptance checks.");
  const after = await evidence(h, project, c);
  if (after.signature !== before.signature) throw new Error("Review evidence changed; rerun review before approval.");
  const report = { ...result, head: c.head, base: c.base, pr: c.pr, signature: before.signature };
  save(path.join(project.dir, "review.toon"), report);
  h.report(result.summary);
  return report;
}
function addRepairs(project, issues, c) {
  const { tasks, all } = contracts(project);
  let next = Math.max(0, ...all.map(t => Number(/^R(\d+)$/.exec(t.id)?.[1] || 0))) + 1;
  for (const issue of issues) {
    if (all.some(t => findingKey(t) === issue.key && t.source?.candidate === c.head)) continue;
    const id = `R${String(next++).padStart(3, "0")}`;
    save(path.join(project.dir, "repairs", `${id}.toon`), { version: 1, id, title: issue.title, goal: issue.goal,
      requirements: issue.requirements || [issue.reason].filter(Boolean), checks: issue.checks, depends_on: tasks.map(t => t.id),
      source: { kind: "candidate_review", finding_key: issue.key, candidate: c.head, evidence: issue.evidence || [] } });
  }
}
function queueRepairs(project, ship, issues, c) {
  const { state, persist } = ship;
  const seen = new Set(contracts(project).all.map(findingKey).filter(Boolean));
  if (state.repair_round >= 2 || !issues.length || issues.some(r => seen.has(r.key)) || new Set(issues.map(r => r.key)).size !== issues.length) throw blocked("Repair loop stopped: recurring finding or two repair rounds exhausted.");
  state.pending_repairs = { issues, candidate: c }; persist();
}
function applyPending(project, ship) {
  const { state, persist } = ship;
  if (!state.pending_repairs) return;
  addRepairs(project, state.pending_repairs.issues, state.pending_repairs.candidate);
  state.pending_repairs = null; state.repair_round++;
  state.phase = "build"; state.verified_head = null; state.candidate = null; state.approved_head = null; state.feedback = null; persist();
}
const preview = (report, c, round) => [`# Final review: PR #${c.pr}`, report.summary, `HEAD: ${c.head}\nBase: ${c.base}\nRepair rounds: ${round}`, "## Review focus", ...(report.review_focus || []), "## Validation", ...(report.validation || []), c.url].join("\n\n");

export async function shipping(h, project, phase) {
  const ship = loadShip(project);
  const { state, persist } = ship;
  if (phase === "review") {
    requireComplete(project);
    const pr = await currentPR(h);
    const c = { head: pr.headRefOid, base: pr.baseRefOid, pr: pr.number, id: pr.id, url: pr.url };
    const report = await review(h, project, c);
    if (report.verdict === "repairs") {
      const decision = await h.review("Select concrete repairs", preview(report, c, state.repair_round), report.repairs);
      if ((await evidence(h, project, c)).signature !== report.signature) throw new Error("Review evidence changed during repair selection.");
      addRepairs(project, report.repairs.filter(r => decision.keys?.includes(r.key)), c);
    }
    return;
  }
  if (phase === "prepare") {
    requireComplete(project);
    state.phase = "prepare"; state.approved_head = null; persist();
    await prepare(h, project, ship); h.report(`Prepared ${state.candidate.url}`); return;
  }
  if (state.phase === "blocked") {
    if (!await h.confirm("Resume blocked workflow?", `${state.blocked?.reason || "Shipping is blocked."}\nResume only after reconciling this with the approved spec/plans.`)) return;
    state.phase = state.blocked?.resume || "build"; state.blocked = null; state.repair_round = 0; persist();
  }
  try {
    while (true) {
      h.signal?.throwIfAborted();
      h.checkpoint?.();
      applyPending(project, ship);
      if (state.phase === "build") { await build(h, project); state.phase = "prepare"; persist(); }
      if (state.phase === "prepare") {
        try { await prepare(h, project, ship); }
        catch (error) {
          if (!error.gate) throw error;
          const signature = digest([error.gate, error.evidence]);
          if (state.last_failure === signature) throw blocked(`Final gate failure recurred: ${error.gate}`);
          const head = await git(h, "rev-parse", "HEAD");
          queueRepairs(project, ship, [{ key: `final-gate:${signature}`, title: `Repair final gate: ${error.gate}`, goal: `Make ${error.gate} pass within the approved spec.`, evidence: [error.evidence], checks: [error.gate] }], { head });
          state.last_failure = signature; persist(); continue;
        }
      }
      const c = state.candidate;
      if (!c) throw new Error("Shipping checkpoint has no candidate.");
      if (state.phase === "done") { await unchanged(h, c); h.report(`Ready: ${c.url}`); return; }
      if (state.phase === "await") { await settled(h, c); state.phase = "review"; persist(); }
      if (state.phase === "review" || state.feedback) {
        const report = await review(h, project, c, state.feedback || "");
        if (report.verdict === "blocked") throw blocked(report.summary);
        if (report.verdict === "repairs") { queueRepairs(project, ship, report.repairs, c); continue; }
        state.phase = "human"; persist();
      }
      if (state.phase === "human") {
        h.checkpoint?.("Human review of exact candidate");
        const file = path.join(project.dir, "review.toon");
        const report = fs.existsSync(file) ? read(file) : null;
        const current = await evidence(h, project, c);
        if (!report || report.head !== c.head || report.signature !== current.signature) { state.phase = "await"; state.approved_head = null; persist(); continue; }
        if (current.red) throw new Error("Reviewer reported PASS while CI is red; refusing human approval.");
        if (state.approved_head !== c.head) {
          const decision = await h.review("Approve exact candidate?", preview(report, c, state.repair_round));
          if (decision.action === "feedback") { state.feedback = decision.feedback; state.repair_round = 0; persist(); continue; }
          if (decision.action !== "approve") return;
          state.approved_head = c.head; persist();
        }
        h.checkpoint?.("Preparing PR title and body");
        const finalized = await h.delegate("ship", `Approved spec: ${specPath(project)}\nReview: ${file}\nCandidate: ${JSON.stringify(c)}`, undefined,
          { type: "object", required: ["title", "body"], additionalProperties: false, properties: { title: { type: "string" }, body: { type: "string" } } },
          { tools: readTools, metadata: { label: "PR summary · Approved candidate", task: "Write title/body without changing code", candidate: c.head }, system: "Return concise human-facing PR title and Markdown body for this approved candidate. Conventional Commit title; no workflow IDs. Do not modify files or GitHub." });
        if (!/^[a-z][a-z0-9-]*(\([^)]+\))?!?: .+/.test(finalized.title) || /\b[PR]\d{3,}\b|Plan-ID:/i.test(finalized.title)) throw new Error("Final title must be a Conventional Commit without workflow IDs.");
        h.checkpoint?.("Before final candidate publication");
        const final = await evidence(h, project, c);
        if (final.red || final.signature !== report.signature) { state.approved_head = null; state.phase = "await"; persist(); continue; }
        await command(h, "gh", ["pr", "edit", String(c.pr), "--title", finalized.title, "--body", finalized.body]);
        await unchanged(h, c);
        const lastSignals = await signals(h, c);
        if (lastSignals.red || lastSignals.pending) throw new Error("CI changed before readiness.");
        if ((await currentPR(h)).isDraft) await command(h, "gh", ["pr", "ready", String(c.pr)]);
        if ((await unchanged(h, c)).isDraft) throw new Error("PR is still draft; exact-HEAD approval is preserved for retry.");
        state.phase = "done"; persist(); h.report(`Ready: ${c.url}`); return;
      }
    }
  } catch (error) {
    // Cancellation or infrastructure failure preserves the resumable phase and approval.
    if (error.blocked) {
      state.blocked = { reason: error.message, resume: state.phase }; state.phase = "blocked"; persist();
    }
    throw error;
  }
}
