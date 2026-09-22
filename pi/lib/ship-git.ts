import { execFileSync } from "node:child_process";
import type { CandidateIdentity } from "./ship-contracts.ts";

export type GitRun = (cwd: string, args: readonly string[]) => string;
export const systemGit: GitRun = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const run = (git: GitRun, cwd: string, args: readonly string[]): string => git(cwd, args).trim();
const clean = (git: GitRun, cwd: string): boolean => run(git, cwd, ["status", "--porcelain=v1", "--untracked-files=all"]) === "";

export interface RebaseResult { before: string; after: string; base: string; rewritten: boolean }
/** Rebases only a clean named candidate, then validates cleanliness, branch, base ancestry and resulting OID. */
export function rebaseCandidate(candidate: CandidateIdentity, git: GitRun = systemGit): RebaseResult {
  const cwd = candidate.worktree;
  if (!clean(git, cwd)) throw new Error("Cannot rebase a dirty candidate worktree.");
  const branch = run(git, cwd, ["branch", "--show-current"]), before = run(git, cwd, ["rev-parse", "HEAD"]);
  if (branch !== candidate.branch.name || before !== candidate.branch.head) throw new Error("Candidate changed before rebase.");
  const base = run(git, cwd, ["rev-parse", `${candidate.remote.name}/${candidate.base.ref}`]);
  if (base !== candidate.base.oid) throw new Error("Base changed before rebase.");
  run(git, cwd, ["rebase", base]);
  const after = run(git, cwd, ["rev-parse", "HEAD"]);
  if (!clean(git, cwd) || run(git, cwd, ["branch", "--show-current"]) !== branch) throw new Error("Rebase left an invalid candidate worktree.");
  try { run(git, cwd, ["merge-base", "--is-ancestor", base, after]); } catch { throw new Error("Rebase result does not contain the approved base."); }
  return { before, after, base, rewritten: before !== after };
}

export interface PushResult { head: string; remoteBefore?: string; mode: "ordinary" | "lease" | "already_published" }
/** Publishes the exact candidate. Rewrites require an exact observed lease and never use an unqualified force. */
export function pushCandidate(candidate: CandidateIdentity, rewritten: boolean, git: GitRun = systemGit): PushResult {
  const { worktree: cwd } = candidate, ref = `refs/heads/${candidate.branch.name}`, remoteRef = `refs/heads/${candidate.branch.name}`;
  const head = run(git, cwd, ["rev-parse", "HEAD"]);
  if (head !== candidate.branch.head || !clean(git, cwd)) throw new Error("Candidate changed before push.");
  let remoteBefore: string | undefined;
  const advertised = run(git, cwd, ["ls-remote", "--heads", candidate.remote.name, remoteRef]);
  if (advertised) {
    const fields = advertised.split(/\s+/); remoteBefore = fields[0];
    if (!remoteBefore || !/^[0-9a-f]{40,64}$/.test(remoteBefore)) throw new Error("Remote returned an invalid branch identity.");
  }
  if (remoteBefore === head) return { head, remoteBefore, mode: "already_published" };
  if (rewritten && (!candidate.remote.oid || remoteBefore !== candidate.remote.oid)) throw new Error("Remote lease changed before rewritten push.");
  try {
    if (!rewritten) run(git, cwd, ["push", candidate.remote.name, `${ref}:${remoteRef}`]);
    else run(git, cwd, ["push", `--force-with-lease=${remoteRef}:${candidate.remote.oid}`, candidate.remote.name, `${ref}:${remoteRef}`]);
  } catch (error) {
    let observed: string;
    try { observed = run(git, cwd, ["ls-remote", "--heads", candidate.remote.name, remoteRef]).split(/\s+/)[0] ?? ""; }
    catch { throw new Error("Push outcome is indeterminate: remote branch could not be observed after failure.", { cause: error }); }
    if (observed !== head) throw new Error(`Push did not confirm the candidate; observed ${observed || "no remote branch"}. Do not retry without refreshing remote identity.`, { cause: error });
    return { head, ...(remoteBefore ? { remoteBefore } : {}), mode: rewritten ? "lease" : "ordinary" };
  }
  const after = run(git, cwd, ["ls-remote", "--heads", candidate.remote.name, remoteRef]).split(/\s+/)[0];
  if (after !== head) throw new Error("Remote branch does not match the pushed candidate.");
  return { head, ...(remoteBefore ? { remoteBefore } : {}), mode: rewritten ? "lease" : "ordinary" };
}
