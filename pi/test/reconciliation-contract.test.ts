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

test("phase contracts allow absent artifacts and reserve only consequential human decisions", () => {
  assert.match(skill("dev-spec"), /Otherwise a decision-complete spec can finish/);
  assert.match(skill("dev-build"), /An approved spec is optional/);
  assert.match(skill("dev-build"), /failed or interrupted commit/);
  assert.match(skill("dev-ship"), /sole writing owner/);
  assert.match(skill("dev-ship"), /An optional independent read-only `review`/);
  assert.match(skill("dev-ship"), /Otherwise make the authorized readiness transition yourself/);
  assert.match(skill("dev-ship"), /Never merge in dev-ship/);
  assert.match(skill("dev-review"), /A missing spec or plan is not itself a blocker/);
  assert.doesNotMatch(skill("dev-ship"), /ship_builder|mandatory reviewer|approved spec, optional plan/i);
});
