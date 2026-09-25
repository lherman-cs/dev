import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import type { RunWorker } from "./worker.ts";

const messageSchema = Type.Object({ title: Type.String({ minLength: 1 }), body: Type.String({ minLength: 1 }) }, { additionalProperties: false });
export type ShipMessage = { title: string; body: string };
export type ShipDecision = "approve" | "cancel" | { tweak: string };
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
const gitBytes = (cwd: string, args: string[]): Buffer => execFileSync("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
const nul = (data: Buffer): string[] => data.toString("utf8").split("\0").filter(Boolean);
const head = (cwd: string) => git(cwd, ["rev-parse", "HEAD"]);
const tree = (cwd: string, rev: string) => git(cwd, ["rev-parse", `${rev}^{tree}`]);

function clean(cwd: string, label: string): void {
  if (gitBytes(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).length) throw new Error(`${label} must be clean (including staged, unstaged and untracked files). Prepare it manually before dev-ship.`);
}
function operations(cwd: string, label: string): void {
  for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "BISECT_LOG", "rebase-apply", "rebase-merge", "sequencer"]) {
    if (fs.existsSync(path.resolve(cwd, git(cwd, ["rev-parse", "--git-path", name])))) throw new Error(`${label} has an unresolved Git operation (${name}); resolve it before dev-ship.`);
  }
}
function mainCheckout(root: string): string | undefined {
  const records = nul(gitBytes(root, ["worktree", "list", "--porcelain", "-z"]));
  const matches: string[] = [];
  let location: string | undefined;
  let branch = false, unsafe = false;
  const flush = () => { if (branch) { if (!location || unsafe) throw new Error("Local main checkout is locked, unavailable or ambiguous; prepare it manually."); matches.push(location); } location = undefined; branch = false; unsafe = false; };
  for (const record of records) {
    if (record.startsWith("worktree ")) { flush(); location = record.slice(9); }
    else if (record === "branch refs/heads/main") branch = true;
    else if (record === "locked" || record.startsWith("locked ") || record === "prunable" || record.startsWith("prunable ")) unsafe = true;
  }
  flush();
  if (matches.length > 1) throw new Error("Local main has ambiguous checkouts; prepare it manually.");
  return matches[0];
}
function checkoutSafe(root: string, checkout: string | undefined, base: string, candidate: string): void {
  if (!checkout) return;
  if (!fs.existsSync(checkout) || git(checkout, ["symbolic-ref", "-q", "HEAD"]) !== "refs/heads/main" || head(checkout) !== base) throw new Error("Local main checkout changed or is unavailable; restart dev-ship.");
  operations(checkout, "Local main checkout");
  clean(checkout, "Local main checkout");
  // Git's fast-forward checkout may overwrite ignored files. Refuse every overlapping
  // ignored path, including directories replaced by files and files replaced by trees.
  const changed = nul(gitBytes(root, ["diff", "--name-only", "-z", base, candidate]));
  const ignored = nul(gitBytes(checkout, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]));
  for (const file of ignored) if (changed.some(other => file === other || file.startsWith(`${other}/`) || other.startsWith(`${file}/`))) {
    throw new Error(`Ignored file obstructs local main checkout: ${file}. Move it manually before dev-ship.`);
  }
}
interface Captured { root: string; source: string; candidate: string; candidateTree: string; main: string; checkout: string | undefined; noop: boolean }
function capture(cwd: string): Captured {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  clean(root, "Source feature branch");
  const source = git(root, ["symbolic-ref", "-q", "--short", "HEAD"]);
  if (!source || source === "main") throw new Error("dev-ship requires a named feature branch, not main or detached HEAD.");
  operations(root, "Source feature branch");
  const candidate = head(root), candidateTree = tree(root, candidate);
  let main: string;
  try { main = git(root, ["rev-parse", "--verify", "refs/heads/main^{commit}"]); }
  catch { throw new Error("Local main is missing; create or prepare local main before dev-ship."); }
  const checkout = mainCheckout(root);
  checkoutSafe(root, checkout, main, candidate);
  if (tree(root, main) === candidateTree) return { root, source, candidate, candidateTree, main, checkout, noop: true };
  if (git(root, ["merge-base", candidate, main]) !== main) throw new Error("Local main is not integrated into the candidate. Prepare and commit an integrated candidate before dev-ship.");
  return { root, source, candidate, candidateTree, main, checkout, noop: false };
}
function unchanged(state: Captured): void {
  try {
    clean(state.root, "Source feature branch");
    operations(state.root, "Source feature branch");
    if (git(state.root, ["symbolic-ref", "-q", "--short", "HEAD"]) !== state.source || head(state.root) !== state.candidate || tree(state.root, state.candidate) !== state.candidateTree ||
      git(state.root, ["rev-parse", "--verify", "refs/heads/main^{commit}"]) !== state.main || mainCheckout(state.root) !== state.checkout) throw new Error("ref or checkout changed");
    checkoutSafe(state.root, state.checkout, state.main, state.candidate);
  } catch (error) { throw new Error(`Approval invalidated by source or local main state change; restart dev-ship with fresh approval. ${error instanceof Error ? error.message : String(error)}`); }
}
function normalize(message: ShipMessage): ShipMessage {
  const title = message.title.trim(), body = message.body.trim();
  if (!title || !body || /[\r\n\0]/.test(title) || body.includes("\0")) throw new Error("Model supplied an invalid commit title or body; no integration occurred.");
  return { title, body };
}
function prepare(state: Captured, message: ShipMessage): { commit: string; dispose(): void } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "dev-ship-"));
  const worktree = path.join(parent, "candidate");
  let attached = false;
  try {
    git(state.root, ["worktree", "add", "--detach", "--quiet", worktree, state.candidate]); attached = true;
    git(worktree, ["reset", "--soft", state.main]);
    // Relative hooksPath is normally resolved from the source worktree root.
    let hooksPath: string | undefined;
    try { hooksPath = git(state.root, ["config", "--get", "core.hooksPath"]); } catch {}
    const hookConfig = hooksPath && !path.isAbsolute(hooksPath) ? ["-c", `core.hooksPath=${path.resolve(state.root, hooksPath)}`] : [];
    // git commit runs ordinary hooks and signing in a temporary linked worktree.
    git(worktree, [...hookConfig, "commit", "-m", message.title, "-m", message.body]);
    const commit = head(worktree);
    if (git(worktree, ["rev-parse", `${commit}^`]) !== state.main || tree(worktree, commit) !== state.candidateTree ||
      git(worktree, ["show", "-s", "--format=%B", commit]).trimEnd() !== `${message.title}\n\n${message.body}` ||
      gitBytes(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).length) {
      throw new Error("Commit hooks changed the approved message, candidate tree or temporary checkout. Nothing was published to main.");
    }
    return { commit, dispose: () => { git(state.root, ["worktree", "remove", worktree]); fs.rmSync(parent, { recursive: true, force: true }); } };
  } catch (error) {
    if (attached || fs.existsSync(worktree)) {
      try { git(state.root, ["worktree", "remove", worktree]); }
      catch { throw new Error(`${error instanceof Error ? error.message : String(error)} Temporary checkout retained for recovery: ${worktree}`); }
    }
    fs.rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}
export async function packageReviewedCandidate(options: { cwd: string; run: RunWorker; decide: (message: ShipMessage) => Promise<ShipDecision> }): Promise<string> {
  const state = capture(options.cwd);
  if (state.noop) return `Nothing to ship: local main (${state.main}) already has the exact candidate tree.`;
  const diff = git(state.root, ["diff", "--stat", state.main, state.candidate]);
  const patch = git(state.root, ["diff", "--no-ext-diff", state.main, state.candidate]).slice(0, 100_000);
  let tweak = "", previous = "";
  for (;;) {
    const message = normalize(await options.run({ cwd: state.root, name: "ship", schema: messageSchema, tools: [], metadata: { phase: "ship", label: "Shipper · message proposal" },
      task: `Propose ONLY a concise Conventional Commit title and brief body for shipping this candidate to local main. Return title and body. Do not modify files.\nSummary:\n${diff}\nPatch (possibly truncated):\n${patch}\n${previous ? `Previous message:\n${previous}\nRequested tweak: ${tweak}\n` : ""}` }));
    unchanged(state);
    const decision = await options.decide(message);
    if (decision === "cancel") return "Shipping to local main cancelled; main was not advanced.";
    if (decision !== "approve") { previous = `${message.title}\n\n${message.body}`; tweak = decision.tweak; continue; }
    unchanged(state);
    const prepared = prepare(state, message);
    let failure: unknown;
    try {
      unchanged(state);
      if (state.checkout) git(state.checkout, ["merge", "--ff-only", "--no-edit", prepared.commit]);
      else git(state.root, ["update-ref", "refs/heads/main", prepared.commit, state.main]);
      if (git(state.root, ["rev-parse", "refs/heads/main"]) !== prepared.commit) throw new Error("Local main did not reach the prepared commit.");
      if (state.checkout) {
        if (head(state.checkout) !== prepared.commit) throw new Error("Local main checkout HEAD did not reach the prepared commit.");
        clean(state.checkout, "Local main checkout after integration");
      }
    } catch (error) { failure = error; }
    try { prepared.dispose(); }
    catch (error) { failure = failure ? new Error(`${String(failure)}; cleanup: ${String(error)}`) : error; }
    const actual = git(state.root, ["rev-parse", "refs/heads/main"]);
    if (failure || actual !== prepared.commit) throw new Error(`Shipping interrupted or failed. Local main is ${actual}; prepared commit was ${prepared.commit}. Inspect local main and its checkout before retrying. ${failure instanceof Error ? failure.message : String(failure ?? "Main changed during integration")}`);
    return `Shipped ${prepared.commit} to local main. Source branch ${state.source} was not changed.`;
  }
}
