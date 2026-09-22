import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import type { CandidateIdentity, CiCheck, Inventory, PullRequestIdentity } from "./ship-contracts.ts";

export type GraphqlRun = (args: readonly string[]) => string;
export type GhRun = (args: readonly string[]) => string;
export interface RequiredContext { context: string; appId?: number }
export interface GitHubEvidence { pullRequest: PullRequestIdentity; checks: CiCheck[]; inventory: Inventory; raw: Readonly<Record<string, unknown>>; }
export const ghGraphql: GraphqlRun = args => execFileSync("gh", ["api", "graphql", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
export const ghRun: GhRun = args => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
export const digest = (value: unknown): string => crypto.createHash("sha256").update(canonical(value)).digest("hex");
function parseRepository(url: string): { owner: string; name: string } {
  const match = /(?:github\.com[/:])([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/.exec(url);
  if (!match) throw new Error(`GitHub evidence requires a github.com remote, got ${url}`);
  return { owner: match[1]!, name: match[2]! };
}
function call(run: GraphqlRun, query: string, variables: Record<string, string | number | null>): Node {
  const args = ["-f", `query=${query}`];
  for (const [name, value] of Object.entries(variables)) if (value !== null) args.push("-F", `${name}=${value}`);
  try { return JSON.parse(run(args)) as Node; } catch (error) { throw new Error(`GitHub GraphQL evidence failed: ${error instanceof Error ? error.message : String(error)}`); }
}
const prQuery = `query($owner:String!,$name:String!,$head:String!,$cursor:String){repository(owner:$owner,name:$name){pullRequests(first:100,after:$cursor,headRefName:$head,states:[OPEN]){nodes{number url state isDraft headRefName headRefOid headRepository{nameWithOwner} baseRefName baseRefOid}pageInfo{hasNextPage endCursor}}}}`;
const checkQuery = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100,after:$cursor){nodes{__typename ... on CheckRun{id name status conclusion detailsUrl checkSuite{app{databaseId} commit{oid}}} ... on StatusContext{id context state targetUrl commit{oid}}}pageInfo{hasNextPage endCursor}}}}}}}}}`;
const threadCommentsQuery = `query($id:ID!,$cursor:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){nodes{id body url createdAt author{login} commit{oid}}pageInfo{hasNextPage endCursor}}}}}`;
const pageQuery = (field: string, selection: string) => `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){${field}(first:100,after:$cursor){nodes{${selection}}pageInfo{hasNextPage endCursor}}}}}`;
function pullRequestPages(run: GraphqlRun, owner: string, name: string, head: string): Node[] {
  const result: Node[] = []; let cursor: string | null = null;
  do {
    const page = ((call(run, prQuery, { owner, name, head, cursor }).data as Node | undefined)?.repository as Node | undefined)?.pullRequests;
    result.push(...nodes(page)); const info = page?.pageInfo as Node | undefined;
    cursor = info?.hasNextPage === true ? string(info, "endCursor") : null;
    if (info?.hasNextPage === true && !cursor) throw new Error("GitHub pagination cursor missing for pull requests.");
  } while (cursor);
  return result;
}
function pages(run: GraphqlRun, owner: string, name: string, number: number, field: string, selection: string): Node[] {
  const result: Node[] = []; let cursor: string | null = null;
  do {
    const pull = (((call(run, pageQuery(field, selection), { owner, name, number, cursor }).data as Node | undefined)?.repository as Node | undefined)?.pullRequest as Node | undefined);
    const page = pull?.[field] as Node | undefined; result.push(...nodes(page));
    const info = page?.pageInfo as Node | undefined; cursor = info?.hasNextPage === true ? string(info, "endCursor") : null;
    if (info?.hasNextPage === true && !cursor) throw new Error(`GitHub pagination cursor missing for ${field}.`);
  } while (cursor);
  return result;
}
function threadWithAllComments(run: GraphqlRun, thread: Node): Node {
  const result: Node[] = []; let cursor: string | null = null; const id = string(thread, "id");
  do { const node = (call(run, threadCommentsQuery, { id, cursor }).data as Node | undefined)?.node; const page = node?.comments as Node | undefined;
    result.push(...nodes(page)); const info = page?.pageInfo as Node | undefined; cursor = info?.hasNextPage === true ? string(info, "endCursor") : null;
    if (info?.hasNextPage === true && !cursor) throw new Error(`GitHub pagination cursor missing for review thread ${id}.`);
  } while (cursor);
  return { ...thread, comments: { nodes: result } };
}
function checkPages(run: GraphqlRun, owner: string, name: string, number: number): Node[] {
  const result: Node[] = []; let cursor: string | null = null;
  do {
    const pull = (((call(run, checkQuery, { owner, name, number, cursor }).data as Node | undefined)?.repository as Node | undefined)?.pullRequest as Node | undefined);
    const rollup = nodes(pull?.commits)[0]?.commit as Node | undefined; const page = rollup?.statusCheckRollup as Node | undefined;
    const contexts = page?.contexts as Node | undefined; result.push(...nodes(contexts)); const info = contexts?.pageInfo as Node | undefined;
    cursor = info?.hasNextPage === true ? string(info, "endCursor") : null;
    if (info?.hasNextPage === true && !cursor) throw new Error("GitHub pagination cursor missing for checks.");
  } while (cursor);
  return result;
}

type Node = { data?: Node; node?: Node; repository?: Node; pullRequest?: Node; pullRequests?: Node; pageInfo?: Node; hasNextPage?: unknown; commits?: Node; commit?: Node; statusCheckRollup?: Node; contexts?: Node; comments?: Node; nodes?: Node[]; number?: unknown; isResolved?: unknown; isOutdated?: unknown; isDraft?: unknown; [key: string]: unknown };
const nodes = (value: unknown): Node[] => Array.isArray((value as Node | undefined)?.nodes) ? (value as Node).nodes! : [];
const string = (node: Node | undefined, key: string): string => typeof (node as Record<string, unknown> | undefined)?.[key] === "string" ? (node as Record<string, string>)[key]! : "";
/** Lists matching repository-owned open PRs even when their head has not yet been pushed. */
export function listBranchPullRequests(candidate: CandidateIdentity, run: GraphqlRun = ghGraphql): PullRequestIdentity[] {
  const { owner, name } = parseRepository(candidate.remote.url);
  return pullRequestPages(run, owner, name, candidate.branch.name).filter(pr =>
    string(pr, "headRefName") === candidate.branch.name &&
    string(pr["headRepository"] as Node, "nameWithOwner").toLowerCase() === `${owner}/${name}`.toLowerCase()
  ).map(pr => {
    const number = Number(pr.number);
    if (!Number.isSafeInteger(number) || number < 1 || !string(pr, "headRefOid") || !string(pr, "baseRefOid") || !string(pr, "baseRefName")) throw new Error("GitHub returned an incomplete pull request identity.");
    return { number, url: string(pr, "url"), state: "OPEN" as const, draft: Boolean(pr.isDraft), head: { name: candidate.branch.name, head: string(pr, "headRefOid") }, base: { ref: string(pr, "baseRefName"), oid: string(pr, "baseRefOid") } };
  });
}
/** Fetches one immutable candidate evidence snapshot. It never mutates GitHub. */
export function collectGitHubEvidence(candidate: CandidateIdentity, run: GraphqlRun = ghGraphql): GitHubEvidence {
  const { owner, name } = parseRepository(candidate.remote.url);
  const prs = pullRequestPages(run, owner, name, candidate.branch.name);
  const matches = prs.filter(pr => string(pr["headRepository"] as Node, "nameWithOwner").toLowerCase() === `${owner}/${name}`.toLowerCase() && string(pr, "headRefName") === candidate.branch.name && string(pr, "headRefOid") === candidate.branch.head && string(pr, "baseRefOid") === candidate.base.oid && string(pr, "baseRefName") === candidate.base.ref);
  if (matches.length !== 1) throw new Error(`Expected exactly one open pull request for ${candidate.branch.name} at ${candidate.branch.head}; found ${matches.length}.`);
  const pr = matches[0]!;
  const number = Number(pr.number); if (!Number.isSafeInteger(number) || number < 1) throw new Error("GitHub returned an invalid pull request number.");
  const reviews = pages(run, owner, name, number, "reviews", "id state body url submittedAt author{login} commit{oid}");
  const comments = pages(run, owner, name, number, "comments", "id body url createdAt author{login}");
  const threads = pages(run, owner, name, number, "reviewThreads", "id isResolved isOutdated").map(thread => threadWithAllComments(run, thread));
  const contexts = checkPages(run, owner, name, number);
  const bounded = (entry: Node): Node => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "body"));
  const raw = { reviews: reviews.map(bounded), comments: comments.map(bounded), reviewThreads: threads.map(bounded), contexts: contexts.map(bounded) };
  const checks = contexts.filter(context => ["CheckRun", "StatusContext"].includes(string(context, "__typename")))
    .map(context => {
      const checkRun = string(context, "__typename") === "CheckRun", suite = context["checkSuite"] as Node | undefined;
      const app = (checkRun ? suite?.["app"] : context["app"]) as Node | undefined, appId = Number(app?.["databaseId"]);
      const commit = checkRun ? suite?.commit as Node | undefined : context.commit as Node | undefined;
      return { id: string(context, "id"), name: string(context, checkRun ? "name" : "context"), head: string(commit, "oid"), state: checkRun ? string(context, "status") : "COMPLETED", conclusion: checkRun ? string(context, "conclusion") || null : string(context, "state"), ...(Number.isSafeInteger(appId) ? { appId } : {}) };
    }).filter(check => check.id && check.name && check.head) as CiCheck[];
  const items = [
    ...checks.map(check => ({ id: check.id, kind: "check" as const, head: check.head, state: `${check.state}:${check.conclusion ?? ""}`, digest: digest(check) })),
    ...reviews.map(review => ({ id: string(review, "id"), kind: "review" as const, head: string(review.commit as Node, "oid"), state: string(review, "state"), digest: digest(review) })),
    ...threads.map(thread => ({ id: string(thread, "id"), kind: "thread" as const, head: candidate.branch.head, state: `${Boolean(thread.isResolved)}:${Boolean(thread.isOutdated)}`, digest: digest(thread) })),
    // Pull request issue comments are not commit-scoped in GitHub's schema. They
    // are candidate-scoped here because this collection was read through the
    // exact pull request identity validated above.
    ...comments.map(comment => ({ id: string(comment, "id"), kind: "comment" as const, head: candidate.branch.head, state: "COMMENT", digest: digest(comment) })),
  ].filter(item => item.id && item.head).sort((a, b) => a.id.localeCompare(b.id));
  const inventory: Inventory = { candidate, items, digest: digest(items) };
  return { pullRequest: { number, url: string(pr, "url"), state: "OPEN", draft: Boolean(pr.isDraft), head: candidate.branch, base: candidate.base }, checks, inventory, raw };
}

/** Verifies CLI authentication before any mutation and returns the authenticated login. */
export function authenticateGitHub(run: GhRun = ghRun): string {
  let login = "";
  try { login = run(["api", "user", "--jq", ".login"]).trim(); } catch (error) { throw new Error(`GitHub authentication failed: ${error instanceof Error ? error.message : String(error)}`); }
  if (!login) throw new Error("GitHub authentication failed: no authenticated login.");
  return login;
}

/** Creates a draft only when no exact PR exists. Callers reconcile uncertain effects with collectGitHubEvidence. */
export function createDraftPullRequest(candidate: CandidateIdentity, title: string, body: string, run: GhRun = ghRun): string {
  authenticateGitHub(run);
  if (!title.trim() || !body.trim()) throw new Error("Draft pull request title and body are required.");
  return run(["pr", "create", "--draft", "--repo", candidate.remote.url, "--head", candidate.branch.name, "--base", candidate.base.ref, "--title", title, "--body", body]).trim();
}

/** Reconciles a prior create intent from live state before creating, then re-observes the immutable PR identity. */
export function ensureDraftPullRequest(candidate: CandidateIdentity, title: string, body: string, graphql: GraphqlRun = ghGraphql, run: GhRun = ghRun): GitHubEvidence {
  try { return collectGitHubEvidence(candidate, graphql); }
  catch (error) {
    if (!(error instanceof Error) || !/found 0\.$/.test(error.message)) throw error;
    const existing = listBranchPullRequests(candidate, graphql);
    if (existing.length) throw new Error(`An open PR already exists for ${candidate.branch.name} (${existing.map(pr => `#${pr.number} at ${pr.head.head}`).join(", ")}); reconcile its base and head before creating a draft.`);
    try { createDraftPullRequest(candidate, title, body, run); }
    catch (createError) {
      // The response can be lost after GitHub accepted the write. Observe before deciding
      // whether another attempt is safe; never blindly issue a second create.
      try { return collectGitHubEvidence(candidate, graphql); }
      catch (observeError) {
        throw new Error(`PR creation was not confirmed. Do not retry until the remote PR inventory is reconciled: ${observeError instanceof Error ? observeError.message : String(observeError)}`, { cause: createError });
      }
    }
    return collectGitHubEvidence(candidate, graphql);
  }
}

/** Changes only the exact observed draft PR to ready. This adapter exposes no merge operation. */
export function markPullRequestReady(pr: PullRequestIdentity, candidate: CandidateIdentity, run: GhRun = ghRun, graphql: GraphqlRun = ghGraphql): void {
  authenticateGitHub(run);
  if (!pr.draft || pr.state !== "OPEN" || pr.head.head !== candidate.branch.head || pr.base.oid !== candidate.base.oid) throw new Error("Pull request identity changed before ready-for-review.");
  const matches = listBranchPullRequests(candidate, graphql).filter(item => item.number === pr.number && item.url === pr.url);
  if (matches.length !== 1 || matches[0]!.head.head !== candidate.branch.head || matches[0]!.base.oid !== candidate.base.oid || matches[0]!.base.ref !== candidate.base.ref || !matches[0]!.draft) throw new Error("Pull request identity changed before ready-for-review.");
  try { run(["pr", "ready", pr.url]); }
  catch (error) {
    try {
      const observed = listBranchPullRequests(candidate, graphql).filter(item => item.number === pr.number && item.url === pr.url);
      if (observed.length === 1 && observed[0]!.head.head === candidate.branch.head && observed[0]!.base.oid === candidate.base.oid && !observed[0]!.draft) return;
    } catch { /* An unavailable observation cannot certify readiness. */ }
    throw new Error("Ready mutation was not confirmed; observe the exact PR before another attempt.", { cause: error });
  }
}

export function readRequiredContexts(candidate: CandidateIdentity, run: GhRun = ghRun): RequiredContext[] {
  const { owner, name } = parseRepository(candidate.remote.url);
  const base = `repos/${owner}/${name}`, result: RequiredContext[] = [];
  const add = (entry: unknown): void => {
    if (!entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>)["context"] !== "string" || !(entry as Record<string, string>)["context"]!.trim()) throw new Error("Branch policy returned an invalid check identity.");
    const check = entry as Record<string, unknown>, app = check["app_id"] ?? check["integration_id"];
    if (app !== undefined && (!Number.isInteger(app) || (app as number) < -1)) throw new Error("Branch policy returned an invalid app identity.");
    result.push({ context: check["context"] as string, ...(typeof app === "number" && app >= 0 ? { appId: app } : {}) });
  };
  let protection: unknown;
  try { protection = JSON.parse(run(["api", `${base}/branches/${encodeURIComponent(candidate.base.ref)}/protection/required_status_checks`])); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/404|Branch not protected/i.test(message)) throw new Error(`Branch protection lookup failed: ${message}`);
    // A 404 alone is not evidence of no required checks: permissions and rulesets can hide them.
    protection = null;
  }
  if (protection !== null) {
    if (!protection || typeof protection !== "object") throw new Error("Branch protection returned an invalid required-check configuration.");
    const record = protection as Record<string, unknown>;
    if (!Array.isArray(record["contexts"]) && !Array.isArray(record["checks"])) throw new Error("Branch protection omitted required-check configuration.");
    if (Array.isArray(record["contexts"])) for (const context of record["contexts"]) add({ context });
    if (Array.isArray(record["checks"])) for (const check of record["checks"]) add(check);
  }
  let rules: unknown;
  try { rules = JSON.parse(run(["api", `${base}/rules/branches/${encodeURIComponent(candidate.base.ref)}`])); }
  catch (error) { throw new Error(`Effective branch rules could not be verified: ${error instanceof Error ? error.message : String(error)}`); }
  if (!Array.isArray(rules)) throw new Error("Effective branch rules returned an invalid policy.");
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") throw new Error("Effective branch rules returned an invalid entry.");
    const entry = rule as Record<string, unknown>;
    if (entry["type"] !== "required_status_checks") {
      // Readiness cannot infer the meaning of unsupported branch policy rules.
      if (typeof entry["type"] !== "string") throw new Error("Effective branch rules returned an invalid rule type.");
      continue;
    }
    const parameters = entry["parameters"] as Record<string, unknown> | undefined;
    if (!parameters || !Array.isArray(parameters["required_status_checks"])) throw new Error("Effective ruleset omitted required-check identities.");
    for (const check of parameters["required_status_checks"]) add(check);
  }
  const unique = new Map(result.map(item => [`${item.context}:${item.appId ?? "*"}`, item]));
  return [...unique.values()];
}

/** Resolves configured protection contexts bijectively. Duplicate display names stop rather than guess. */
export function mapRequiredContexts(required: readonly RequiredContext[], checks: readonly (CiCheck & { appId?: number })[]): CiCheck[] {
  return required.map(item => {
    const matches = checks.filter(check => check.name === item.context && (item.appId === undefined || check.appId === item.appId));
    if (matches.length !== 1) throw new Error(`Required context ${item.context} mapped to ${matches.length} checks.`);
    return matches[0]!;
  });
}

export function selectExpectedReviewSignals(signals: readonly { kind: "author" | "check"; value: string }[], evidence: GitHubEvidence): string[] {
  return signals.map(signal => {
    const matches = signal.kind === "check"
      ? evidence.checks.filter(check => check.name === signal.value).map(check => check.id)
      : evidence.inventory.items.filter(item => item.kind !== "check" && string((evidence.raw["reviews"] as Node[] | undefined)?.find(entry => string(entry, "id") === item.id)?.["author"] as Node | undefined, "login") === signal.value || string((evidence.raw["comments"] as Node[] | undefined)?.find(entry => string(entry, "id") === item.id)?.["author"] as Node | undefined, "login") === signal.value).map(item => item.id);
    if (matches.length === 0) throw new Error(`Expected review signal ${signal.kind}:${signal.value} was not observed.`);
    return `${signal.kind}:${signal.value}`;
  });
}

/** Fetches one explicitly identified object and caps returned evidence. */
export function fetchExactGitHubObject(id: string, expectedHead: string, maxCharacters: number, run: GraphqlRun = ghGraphql): Readonly<Record<string, unknown>> {
  if (!id || maxCharacters < 1 || maxCharacters > 20_000) throw new Error("Invalid exact-object evidence request.");
  const query = `query($id:ID!){node(id:$id){__typename ... on PullRequestReview{id body url commit{oid}} ... on IssueComment{id body url pullRequest{headRefOid}} ... on CheckRun{id name detailsUrl status conclusion checkSuite{commit{oid}}}}}`;
  const node = (call(run, query, { id }).data as Node | undefined)?.node;
  const type = string(node, "__typename");
  const observedHead = type === "IssueComment" ? string(node?.["pullRequest"] as Node, "headRefOid") : type === "CheckRun" ? string((node?.["checkSuite"] as Node | undefined)?.commit as Node, "oid") : string(node?.commit as Node, "oid");
  if (!node || string(node, "id") !== id || observedHead !== expectedHead) throw new Error("GitHub object identity is stale or mismatched.");
  const body = string(node, "body");
  return { ...node, ...(body ? { body: body.slice(0, maxCharacters), truncated: body.length > maxCharacters } : {}) };
}
