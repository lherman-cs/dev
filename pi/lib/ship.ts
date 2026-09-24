import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { RunWorker } from "./worker.ts";

const commitParams = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 500 }),
  paths: Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { minItems: 1, maxItems: 500 }),
}, { additionalProperties: false });

const git = (cwd: string, args: string[], input?: Buffer | string): string =>
  execFileSync("git", args, { cwd, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();

const safeName = (value: string): string => {
  const cleaned = value.trim().replace(/^ship\//, "").replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/^[-/.]+|[-/.]+$/g, "");
  if (!cleaned || cleaned.includes("..")) throw new Error("Shipping branch name is empty or unsafe.");
  return cleaned;
};

const assertRelativePath = (value: string): string => {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Unsafe shipping path: ${value}`);
  }
  return normalized;
};

function replaceTree(cwd: string, sourceRoot: string, revision: string): void {
  for (const entry of fs.readdirSync(cwd)) if (entry !== ".git") fs.rmSync(path.join(cwd, entry), { recursive: true, force: true });
  const archive = execFileSync("git", ["archive", "--format=tar", revision], { cwd: sourceRoot, maxBuffer: 256 * 1024 * 1024 });
  execFileSync("tar", ["-xf", "-", "-C", cwd], { input: archive, stdio: ["pipe", "ignore", "pipe"], maxBuffer: 256 * 1024 * 1024 });
}

function tree(cwd: string, revision = "HEAD"): string {
  return git(cwd, ["rev-parse", `${revision}^{tree}`]);
}

function sourceState(cwd: string): { root: string; baseline: string; candidate: string; candidateTree: string; sourceBranch: string } {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (git(root, ["status", "--porcelain", "--untracked-files=all"])) throw new Error("dev-review must leave a clean committed candidate before dev-ship.");
  const sourceBranch = git(root, ["branch", "--show-current"]);
  if (!sourceBranch) throw new Error("dev-ship requires a named source branch.");
  const candidate = git(root, ["rev-parse", "HEAD"]);
  const main = git(root, ["rev-parse", "main"]);
  const baseline = git(root, ["merge-base", candidate, main]);
  if (baseline !== main) throw new Error("Local main moved beyond the baseline integrated by dev-review. Run dev-review again.");
  return { root, baseline, candidate, candidateTree: tree(root, candidate), sourceBranch };
}

function isolatedWorkspace(sourceRoot: string, baseline: string, candidate: string): { dir: string; baselineCommit: string; dispose(): void } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "dev-ship-model-"));
  const dir = path.join(parent, "repo");
  fs.mkdirSync(dir);
  git(dir, ["init", "-q", "-b", "ship-work"]);
  git(dir, ["config", "user.name", "dev-ship"]);
  git(dir, ["config", "user.email", "dev-ship@local"]);
  replaceTree(dir, sourceRoot, baseline);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "baseline"]);
  const baselineCommit = git(dir, ["rev-parse", "HEAD"]);
  replaceTree(dir, sourceRoot, candidate);
  return { dir, baselineCommit, dispose: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

function commitTool(cwd: string): ToolDefinition<typeof commitParams, Record<string, never>, unknown> {
  return {
    name: "ship_commit",
    label: "Ship commit",
    description: "Commit selected existing candidate paths without editing their content. Use each changed path exactly once.",
    parameters: commitParams,
    async execute(_id, args: Static<typeof commitParams>) {
      const paths = [...new Set(args.paths.map(assertRelativePath))];
      const changed = new Set(git(cwd, ["status", "--porcelain", "--untracked-files=all"]).split("\n").filter(Boolean).map(line => line.slice(3).split(" -> ").at(-1)!).filter(Boolean));
      for (const p of paths) if (!changed.has(p)) throw new Error(`Path is not currently changed: ${p}`);
      git(cwd, ["add", "--", ...paths]);
      git(cwd, ["commit", "-qm", args.message.trim()]);
      return { content: [{ type: "text" as const, text: `Committed ${paths.length} path(s).` }], details: {} };
    },
  };
}

function applyIsolatedHistory(sourceRoot: string, workspace: string, isolatedBaseline: string, baseline: string, branchName: string): { branch: string; head: string; worktree: string } {
  try { git(sourceRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`]); throw new Error(`Shipping branch already exists: ${branchName}`); }
  catch (error) { if (error instanceof Error && error.message.startsWith("Shipping branch")) throw error; }

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "dev-ship-final-"));
  const worktree = path.join(parent, "worktree");
  let created = false;
  try {
    git(sourceRoot, ["worktree", "add", "-q", "-b", branchName, worktree, baseline]);
    created = true;
    const commits = git(workspace, ["rev-list", "--reverse", `${isolatedBaseline}..HEAD`]).split("\n").filter(Boolean);
    if (!commits.length) throw new Error("Shipping model produced no commits.");
    for (const commit of commits) {
      const patch = execFileSync("git", ["format-patch", "--stdout", "--no-signature", "-1", commit], { cwd: workspace, maxBuffer: 64 * 1024 * 1024 });
      execFileSync("git", ["am", "-q"], { cwd: worktree, input: patch, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    }
    return { branch: branchName, head: git(worktree, ["rev-parse", "HEAD"]), worktree };
  } catch (error) {
    if (created) {
      try { git(sourceRoot, ["worktree", "remove", "--force", worktree]); } catch {}
      try { git(sourceRoot, ["branch", "-D", branchName]); } catch {}
    }
    fs.rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}

export async function packageReviewedCandidate(options: { cwd: string; name?: string; run: RunWorker }): Promise<string> {
  const source = sourceState(options.cwd);
  const suffix = safeName(options.name || source.sourceBranch);
  const branch = `ship/${suffix}`;
  const isolated = isolatedWorkspace(source.root, source.baseline, source.candidate);
  try {
    const beforeTree = tree(source.root, source.candidate);
    if (beforeTree !== source.candidateTree) throw new Error("Reviewed candidate changed before shipping started.");

    await options.run({
      cwd: isolated.dir,
      name: "ship",
      skill: "dev-ship",
      task: "Group the existing candidate changes into the fewest coherent shippable commits. Do not edit files. Use ship_commit for every commit, then finish.",
      tools: ["read", "grep", "find", "ls"],
      scopedTools: [commitTool(isolated.dir)],
      metadata: { phase: "ship", label: "Shipper · commit packaging" },
    });

    if (git(isolated.dir, ["status", "--porcelain", "--untracked-files=all"])) throw new Error("Shipping model left uncommitted candidate content.");
    if (tree(isolated.dir) !== source.candidateTree) throw new Error("Shipping model changed candidate content; no shipping branch was created.");
    if (tree(source.root, source.candidate) !== source.candidateTree) throw new Error("Reviewed candidate changed while shipping ran.");

    const final = applyIsolatedHistory(source.root, isolated.dir, isolated.baselineCommit, source.baseline, branch);
    try {
      const finalTree = tree(final.worktree);
      const diff = git(source.root, ["diff", "--exit-code", source.candidate, final.head]);
      if (finalTree !== source.candidateTree || diff) throw new Error("Final shipping branch is not tree-equivalent to the reviewed candidate.");
      if (git(final.worktree, ["status", "--porcelain", "--untracked-files=all"])) throw new Error("Final shipping worktree is not clean.");
      const parents = git(source.root, ["rev-list", "--parents", `${source.baseline}..${final.head}`]).split("\n").filter(Boolean);
      if (parents.some(line => line.trim().split(/\s+/).length !== 2)) throw new Error("Shipping history is not linear.");
      return `Created ${final.branch} with ${parents.length} clean commit(s). Tree equivalence to the reviewed candidate is exact.`;
    } catch (error) {
      try { git(source.root, ["worktree", "remove", "--force", final.worktree]); } catch {}
      try { git(source.root, ["branch", "-D", final.branch]); } catch {}
      throw error;
    }
  } finally {
    isolated.dispose();
  }
}
