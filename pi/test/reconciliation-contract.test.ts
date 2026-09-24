import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const text = (path: string): string => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const skill = (name: string): string => text(`skills/${name}/SKILL.md`);

test("one lazy reference owns worktree recovery from live evidence", () => {
  const policy = text("references/reconcile.md");
  for (const name of ["dev-spec", "dev-build", "dev-ship"]) {
    assert.match(skill(name), /Read `\.\.\/\.\.\/references\/reconcile\.md` at entry/);
  }
  for (const requirement of [/no prior session/, /including untracked files/, /Verify uncertain side effects/, /not a prerequisite/, /outside the worktree/, /backup location or failure/, /best-effort, not a veto/, /Never sweep ignored files/, /committed history/, /independent remote work/]) {
    assert.match(policy, requirement);
  }
});

test("one lazy engineering reference owns minimal-change guidance for every role", () => {
  const policy = text("references/engineering.md");
  for (const name of ["dev-spec", "dev-build", "dev-ship", "dev-review", "dev-explore"]) {
    assert.match(skill(name), /Read `\.\.\/\.\.\/references\/engineering\.md`/);
    assert.doesNotMatch(skill(name), /Be aggressively minimal|smallest durable diff/);
  }
  for (const requirement of [/requested problem/, /deletion or reuse/, /standard-library/, /direct code/, /smallest durable change/, /correctness, safety, compatibility, accessibility, and necessary observability/, /speculative flexibility/]) {
    assert.match(policy, requirement);
  }
});

test("three stage contracts keep approval, local review, and history ownership distinct", () => {
  assert.match(skill("dev-spec"), /explicit human approval/);
  assert.match(skill("dev-build"), /approval of the outcome must be established/);
  assert.match(skill("dev-build"), /explicit conversational approval/);
  assert.match(skill("dev-build"), /obtain it before implementation/);
  assert.match(skill("dev-build"), /Diagnose uncertain or interrupted writes from live state/);
  assert.match(skill("dev-ship"), /fixed local comparison base and exact candidate scope/);
  const ship = skill("dev-ship");
  assert.ok(ship.indexOf("**Orient and walk through.**") < ship.indexOf("**Review the settled candidate.**"));
  assert.ok(ship.indexOf("**Review the settled candidate.**") < ship.indexOf("**Confirm, then refine.**"));
  for (const requirement of [
    /short map of resulting behavior/, /one meaningful topic at a time/, /concrete scenario/,
    /recommend a direction, then pause for the human's questions/, /skip settled or routine details/,
    /`ask_user_question` for every interaction that solicits human input/,
    /including walkthrough pauses, consequential decisions, permission for a second reviewer, and final convergence/,
    /recommended option first and label it `\(Recommended\)`/,
    /Never ask for input only in prose or treat silence as agreement/,
    /Fix clear in-scope defects directly/, /Discuss consequential changes .* before implementing them/,
    /one independent read-only `review` on the stable agreed candidate/,
    /reopen only the relevant human discussion/, /Do not automatically launch another reviewer/,
    /obtain human permission first/, /A resumed session alone does not justify repeating a reviewer launch/,
    /Material repairs invalidate affected evidence/, /explicitly ask the human whether meaningful feedback is exhausted/,
    /Only then create a recoverable pre-cleanup reference/, /verify tree equivalence/,
    /History-only changes preserving the reviewed tree do not require another human approval/,
    /Do not fetch, push, mutate remote review state, or merge/,
  ]) assert.match(ship, requirement);
  assert.doesNotMatch(ship, /every human decision and review checkpoint|re-review interactions|Re-run it only when repairs materially change/);
  assert.match(skill("dev-review"), /uncommitted changes are not supplied/);
  assert.match(text("references/reconcile.md"), /except for dev-ship's explicitly bounded cleanup/);
  assert.doesNotMatch(skill("dev-ship"), /PR readiness|mandatory reviewer|ship_builder/i);
});

test("ship documentation describes human-first walkthrough and one stable review", () => {
  const workflow = readFileSync(fileURLToPath(new URL("../../WORKFLOW.md", import.meta.url)), "utf8");
  const readme = readFileSync(fileURLToPath(new URL("../../README.md", import.meta.url)), "utf8");
  assert.match(workflow, /one concrete topic at a time/);
  assert.match(workflow, /Every request for human input uses `ask_user_question` with a recommended choice/);
  assert.match(workflow, /invoke it once after the human walkthrough and known repairs settle/);
  assert.match(workflow, /without an automatic second review/);
  assert.match(workflow, /obtaining human permission/);
  assert.match(workflow, /reuse review evidence still applicable/);
  assert.match(readme, /topic-by-topic human walkthrough/);
  assert.doesNotMatch(readme, /Shipper may request read-only review/);
});

test("Verifier owns operation routing while Explorer retains only investigative delegation", () => {
  const verifier = text("lib/verifier.ts"), explorer = text("lib/worker.ts");
  assert.match(verifier, /Send every test, build, lint check, benchmark, and acceptance gate to verify regardless of expected duration or output size/);
  assert.match(verifier, /actual owner worktree/);
  assert.match(explorer, /Delegate read-only evidence gathering when it is reasonably expected to take material time/);
  assert.doesNotMatch(explorer, /slow or noisy targeted verification/);
  assert.doesNotMatch(skill("dev-explore"), /You may run targeted tests/);
  assert.match(skill("dev-explore"), /do not launch verification commands/);
  assert.doesNotMatch(skill("dev-build"), /slow or noisy targeted verification/);
});

test("documentation advertises only the local three-stage workflow", () => {
  const docs = ["../../README.md", "../../WORKFLOW.md"].map(path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
  for (const doc of docs) {
    assert.match(doc, /`spec`, `build`, and `ship`/);
    assert.doesNotMatch(doc, /dev a plan|`spec`, `plan`, `build`|PR readiness state/);
    assert.match(doc, /human/i);
  }
});
