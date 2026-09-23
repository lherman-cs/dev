import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const text = (path: string): string => readFileSync(fileURLToPath(new URL(`../skills/${path}`, import.meta.url)), "utf8");
const skill = (name: string): string => text(`${name}/SKILL.md`);

test("one lazy reference owns worktree recovery from live evidence", () => {
  const policy = text("references/reconcile.md");
  for (const name of ["dev-spec", "dev-build", "dev-ship"]) {
    assert.match(skill(name), /Read `\.\.\/references\/reconcile\.md` at entry/);
  }
  for (const requirement of [/no prior session/, /including untracked files/, /Verify uncertain side effects/, /not a prerequisite/, /outside the worktree/, /backup location or failure/, /best-effort, not a veto/, /Never sweep ignored files/, /committed history/, /independent remote work/]) {
    assert.match(policy, requirement);
  }
});

test("one lazy engineering reference owns minimal-change guidance for every role", () => {
  const policy = text("references/engineering.md");
  for (const name of ["dev-spec", "dev-build", "dev-ship", "dev-review", "dev-explore"]) {
    assert.match(skill(name), /Read `\.\.\/references\/engineering\.md`/);
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
  assert.match(skill("dev-ship"), /Pause for the human's questions, concerns, and review priorities before substantive review/);
  assert.match(skill("dev-ship"), /agreement on the repair direction before material repairs/);
  assert.match(skill("dev-ship"), /taste-only/);
  assert.match(skill("dev-ship"), /affected behavior, and re-review interactions/);
  assert.match(skill("dev-ship"), /Explicitly ask the human whether meaningful review feedback remains/);
  assert.match(skill("dev-ship"), /recoverable pre-cleanup reference/);
  assert.match(skill("dev-ship"), /Verify tree equivalence/);
  assert.match(skill("dev-ship"), /Do not fetch, rebase onto a moving integration branch, push, create or mutate a PR, or merge/);
  assert.match(skill("dev-review"), /uncommitted changes are not supplied/);
  assert.match(text("references/reconcile.md"), /except for dev-ship's explicitly bounded cleanup/);
  assert.doesNotMatch(skill("dev-ship"), /PR readiness|mandatory reviewer|ship_builder/i);
});

test("documentation advertises only the local three-stage workflow", () => {
  const docs = ["../../README.md", "../../WORKFLOW.md"].map(path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
  for (const doc of docs) {
    assert.match(doc, /`spec`, `build`, and `ship`/);
    assert.doesNotMatch(doc, /dev a plan|`spec`, `plan`, `build`|PR readiness state/);
    assert.match(doc, /human/i);
  }
});
