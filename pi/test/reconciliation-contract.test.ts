import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const text = (path: string): string => readFileSync(fileURLToPath(new URL(`../skills/${path}`, import.meta.url)), "utf8");
const skill = (name: string): string => text(`${name}/SKILL.md`);

test("one lazy reference owns the cross-phase recovery contract", () => {
  const policy = text("references/reconcile.md");
  for (const name of ["dev-spec", "dev-plan", "dev-build", "dev-ship", "dev-ship-builder"]) {
    assert.match(skill(name), /Read `\.\.\/references\/reconcile\.md` at entry/);
  }
  for (const requirement of [/no prior session/, /including untracked files/, /Verify uncertain side effects/, /exclusive writing ownership/, /outside the worktree/, /backup location or failure/, /best-effort, not a veto/, /Never sweep ignored files/, /committed history/, /independent remote work/]) {
    assert.match(policy, requirement);
  }
});

test("phase-specific gates remain where they belong", () => {
  assert.match(skill("dev-spec"), /Only explicit human approval/);
  assert.match(skill("dev-plan"), /Before approval/);
  assert.match(skill("dev-build"), /A plan is optional/);
  assert.match(skill("dev-build"), /NEEDS_REPLAN/);
  assert.match(skill("dev-ship"), /Never merge/);
  assert.match(skill("dev-ship"), /destructive history or remote recovery to the human/);
  assert.match(skill("dev-ship-builder"), /material drift or competing ownership/);
  assert.match(skill("dev-review"), /fresh read-only agent/);
  assert.match(skill("dev-review"), /rather than PASS/);
});
