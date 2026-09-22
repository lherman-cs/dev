import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { systemGit, type GitRun } from "./ship-git.ts";
import { ghRun, ghGraphql, listBranchPullRequests, type GhRun, type GraphqlRun } from "./github-evidence.ts";
import type { CandidateIdentity, PullRequestIdentity } from "./ship-contracts.ts";

const oid = /^[a-f0-9]{40,64}$/;
const run = (git: GitRun, cwd: string, ...args: string[]) => git(cwd, args).trim();
export interface ShipObservation {
  candidate: CandidateIdentity;
  approved: { spec: { path: string; sha256: string }; plan: { path: string; sha256: string } };
  commits: string[];
  diffStat: string;
  pullRequests: PullRequestIdentity[];
  targetSource: "existing_pr" | "explicit" | "default";
  corrections: string[];
  provenance: "unverified";
}
/** Read-only admission: target and approval are observed, but scope is never inferred as verified. */
export function observeShip(cwd: string, specPath: string, planPath: string, explicitBase?: string,
  deps: { git?: GitRun; gh?: GhRun; graphql?: GraphqlRun; remote?: string } = {}): ShipObservation {
  const git = deps.git ?? systemGit, gh = deps.gh ?? ghRun;
  const root = run(git, cwd, "rev-parse", "--show-toplevel");
  const worktree = run(git, cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const branch = run(git, cwd, "branch", "--show-current"), head = run(git, cwd, "rev-parse", "HEAD");
  const remote = deps.remote ?? "origin", url = run(git, cwd, "remote", "get-url", remote);
  if (!branch || !oid.test(head)) throw new Error("Shipping requires a named branch and a valid HEAD.");
  if (run(git, cwd, "status", "--porcelain=v1", "--untracked-files=all")) throw new Error("Shipping requires a clean worktree.");
  const artifact = (name: string) => {
    const absolute = path.resolve(root, name), relative = path.relative(root, absolute);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.statSync(absolute).isFile()) throw new Error(`Invalid approved artifact: ${name}`);
    if (!/^Status: APPROVED\b/m.test(fs.readFileSync(absolute, "utf8"))) throw new Error(`Artifact is not approved: ${relative}`);
    return { path: relative, sha256: crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") };
  };
  const approved = { spec: artifact(specPath), plan: artifact(planPath) };
  const repo = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (!repo) throw new Error("Shipping requires a GitHub remote.");
  const metadata = JSON.parse(gh(["api", `repos/${repo[1]}/${repo[2]}`])) as Record<string, unknown>;
  if (typeof metadata["default_branch"] !== "string" || !metadata["default_branch"]) throw new Error("Remote default branch is unavailable.");
  const defaultBranch = metadata["default_branch"];
  const baseOid = (ref: string): string => {
    const value = run(git, cwd, "rev-parse", `refs/remotes/${remote}/${ref}`);
    if (!oid.test(value)) throw new Error(`Invalid target branch: ${ref}`);
    return value;
  };
  const defaultOid = baseOid(defaultBranch);
  const proposed: CandidateIdentity = { repository: { root: worktree, coordinate: url }, worktree: root,
    branch: { name: branch, head }, base: { ref: defaultBranch, oid: defaultOid }, remote: { name: remote, url } };
  const prs = listBranchPullRequests(proposed, deps.graphql ?? ghGraphql);
  if (prs.length > 1) throw new Error(`Multiple open PRs for ${branch}; select a target with human direction.`);
  const explicitOid = explicitBase && explicitBase !== branch ? baseOid(explicitBase) : undefined;
  const existing = prs[0];
  if (existing && explicitOid && (existing.base.ref !== explicitBase || existing.base.oid !== explicitOid)) throw new Error("Existing PR and explicit target conflict; human direction required.");
  const ref = existing?.base.ref ?? (explicitOid ? explicitBase! : defaultBranch);
  const base = baseOid(ref);
  if (existing && base !== existing.base.oid) throw new Error("Existing PR base identity drifted.");
  if (ref === branch || base === head) throw new Error("Candidate and base cannot be the same branch or commit.");
  try { run(git, cwd, "merge-base", "--is-ancestor", base, head); }
  catch { throw new Error("Candidate is not based on the selected target; guarded rebase required."); }
  const commits = run(git, cwd, "log", "--format=%H %s", `${base}..${head}`).split("\n").filter(Boolean).slice(0, 100);
  if (!commits.length) throw new Error("Candidate has no commits beyond the target.");
  const diffStat = run(git, cwd, "diff", "--stat", `${base}...${head}`).slice(0, 8_000);
  return { candidate: { ...proposed, base: { ref, oid: base } }, approved, commits, diffStat, pullRequests: prs,
    targetSource: existing ? "existing_pr" : explicitOid ? "explicit" : "default",
    corrections: explicitBase === branch && !existing ? [`Self-base ${branch} rejected; using ${defaultBranch}.`] : [], provenance: "unverified" };
}
