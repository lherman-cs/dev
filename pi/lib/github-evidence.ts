import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import type { CandidateIdentity, CiCheck, Inventory, PullRequestIdentity } from "./ship-contracts.ts";

export type GraphqlRun = (args: readonly string[]) => string;
export interface GitHubEvidence { pullRequest: PullRequestIdentity; checks: CiCheck[]; inventory: Inventory; raw: Readonly<Record<string, unknown>>; }
export const ghGraphql: GraphqlRun = args => execFileSync("gh", ["api", "graphql", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

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
const prQuery = `query($owner:String!,$name:String!,$head:String!){repository(owner:$owner,name:$name){pullRequests(first:20,headRefName:$head,states:[OPEN]){nodes{number url state isDraft headRefName headRefOid baseRefName baseRefOid}}}}`;
const checkQuery = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100,after:$cursor){nodes{__typename ... on CheckRun{id name status conclusion detailsUrl commit{oid}}pageInfo{hasNextPage endCursor}}}}}}}}}`;
const threadCommentsQuery = `query($id:ID!,$cursor:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){nodes{id body url createdAt author{login} commit{oid}}pageInfo{hasNextPage endCursor}}}}}`;
const pageQuery = (field: string, selection: string) => `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){${field}(first:100,after:$cursor){nodes{${selection}}pageInfo{hasNextPage endCursor}}}}}`;
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
/** Fetches one immutable candidate evidence snapshot. It never mutates GitHub. */
export function collectGitHubEvidence(candidate: CandidateIdentity, run: GraphqlRun = ghGraphql): GitHubEvidence {
  const { owner, name } = parseRepository(candidate.remote.url);
  const prs = nodes(((call(run, prQuery, { owner, name, head: candidate.branch.name }).data as Node | undefined)?.repository as Node | undefined)?.pullRequests);
  const matches = prs.filter(pr => string(pr, "headRefOid") === candidate.branch.head && string(pr, "baseRefOid") === candidate.base.oid && string(pr, "baseRefName") === candidate.base.ref);
  if (matches.length !== 1) throw new Error(`Expected exactly one open pull request for ${candidate.branch.name} at ${candidate.branch.head}; found ${matches.length}.`);
  const pr = matches[0]!;
  const number = Number(pr.number); if (!Number.isSafeInteger(number) || number < 1) throw new Error("GitHub returned an invalid pull request number.");
  const reviews = pages(run, owner, name, number, "reviews", "id state body url submittedAt author{login} commit{oid}");
  const comments = pages(run, owner, name, number, "comments", "id body url createdAt author{login} commit{oid}");
  const threads = pages(run, owner, name, number, "reviewThreads", "id isResolved isOutdated").map(thread => threadWithAllComments(run, thread));
  const contexts = checkPages(run, owner, name, number);
  const raw = { reviews, comments, reviewThreads: threads, contexts };
  const checks = contexts.filter(context => string(context, "__typename") === "CheckRun")
    .map(context => ({ id: string(context, "id"), name: string(context, "name"), head: string(context.commit as Node, "oid"), state: string(context, "status"), conclusion: string(context, "conclusion") || null }))
    .filter(check => check.id && check.name && check.head) as CiCheck[];
  const items = [
    ...checks.map(check => ({ id: check.id, kind: "check" as const, head: check.head, state: `${check.state}:${check.conclusion ?? ""}`, digest: digest(check) })),
    ...reviews.map(review => ({ id: string(review, "id"), kind: "review" as const, head: string(review.commit as Node, "oid"), state: string(review, "state"), digest: digest(review) })),
    ...threads.map(thread => ({ id: string(thread, "id"), kind: "thread" as const, head: candidate.branch.head, state: `${Boolean(thread.isResolved)}:${Boolean(thread.isOutdated)}`, digest: digest(thread) })),
    ...comments.map(comment => ({ id: string(comment, "id"), kind: "comment" as const, head: string(comment.commit as Node, "oid"), state: "COMMENT", digest: digest(comment) })),
  ].filter(item => item.id && item.head).sort((a, b) => a.id.localeCompare(b.id));
  const inventory: Inventory = { candidate, items, digest: digest(items) };
  return { pullRequest: { number, url: string(pr, "url"), state: "OPEN", draft: Boolean(pr.isDraft), head: candidate.branch, base: candidate.base }, checks, inventory, raw };
}
