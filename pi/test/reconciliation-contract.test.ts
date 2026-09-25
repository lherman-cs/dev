import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const text = (path: string): string => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const skill = (name: string): string => text(`skills/${name}/SKILL.md`);

test("shared references own reconciliation and engineering policy", () => {
  const reconcile = text("references/reconcile.md"), engineering = text("references/engineering.md");
  for (const name of ["dev-spec", "dev-build", "dev-review"]) assert.match(skill(name), /references\/reconcile\.md/);
  for (const name of ["dev-spec", "dev-build", "dev-review"]) assert.match(skill(name), /references\/engineering\.md/);
  for (const requirement of [/no prior session/, /including untracked files/, /Verify uncertain side effects/, /outside the worktree/, /Never sweep ignored files/]) assert.match(reconcile, requirement);
  for (const requirement of [/requested problem/, /deletion or reuse/, /smallest durable change/, /speculative flexibility/]) assert.match(engineering, requirement);
});

test("dev-spec converges on a narrow coherent build target", () => {
  const spec = skill("dev-spec");
  for (const requirement of [
    /alignment quality, not speed to a draft/,
    /desired product or user outcome and its motivation/,
    /important invariants/,
    /Actively narrow scope/,
    /smallest coherent shippable slice/,
    /one spec per coherent shippable unit/,
    /propose concrete spec boundaries and sequencing/,
    /Implementation design belongs to build/,
    /scope exclusions are explicit/,
    /little room to solve the wrong problem/,
    /explicit human approval/,
  ]) assert.match(spec, requirement);
});

test("dev-review reviews the observed diff, repairs bugs, and obtains consequential approvals", () => {
  const review = skill("dev-review");
  for (const requirement of [
    /candidate diff, comparison scope, and applicable agreed specifications and intent/,
    /including relevant uncommitted changes/,
    /A newly written spec is not required/,
    /consequentially ambiguous/,
    /spec alignment and material correctness/,
    /Avoid style-only cleanup, speculative refactoring, unrelated defects, and system-model teaching/,
    /behavior, contracts, data and security effects, compatibility, operational risk/,
    /major architecture, ownership, dependency, or maintainability choices/,
    /Repair clearly incorrect in-scope code directly and validate/,
    /without requesting permission/,
    /explicit human approval for \*\*all consequential changes\*\*/,
    /even spec-compliant behavior and major design choices/,
    /high-level batches by outcome or decision/,
    /alignment with agreed intent, why it matters, relevant evidence or uncertainty, and a recommended direction/,
    /approval, requested changes, and deferral/,
    /potentially intentional spec deviations/,
    /Implement and validate approved requested changes yourself/,
    /materially alter approved effects, revisit affected approvals and validation/,
    /Deferral leaves an unresolved concern/,
    /applicable validation passes, every required batch is approved, and material concerns are resolved/,
    /Do not merge the integration branch, stage, commit/,
    /human prepares integration and commits before Ship/,
    /material changes introduced afterward need renewed review/,
  ]) assert.match(review, requirement);
  assert.doesNotMatch(review, /Reviewer PASS|repair audit|clean, fully committed reviewed candidate/i);
});

test("dev-ship model is only an isolated commit grouper", () => {
  const ship = skill("dev-ship");
  for (const requirement of [
    /disposable repository prepared by the deterministic ship runtime/,
    /cannot rely on or inspect the source development worktree/,
    /Do not edit files/,
    /fewest coherent shippable commits/,
    /Use `ship_commit`/,
    /Prefer one commit unless/,
    /runtime independently verifies exact tree equivalence/,
  ]) assert.match(ship, requirement);
  assert.doesNotMatch(ship, /references\/reconcile|Read `\.\.\/\.\.\/references|Create an isolated|source branch history/i);
});


test("documentation exposes the four phase boundary", () => {
  const workflow = readFileSync(fileURLToPath(new URL("../../WORKFLOW.md", import.meta.url)), "utf8");
  const readme = readFileSync(fileURLToPath(new URL("../../README.md", import.meta.url)), "utf8");
  for (const doc of [workflow, readme]) {
    for (const phase of ["spec", "build", "review", "ship"]) assert.match(doc, new RegExp(phase, "i"));
    assert.match(doc, /Review.*foreground|foreground.*Review/is);
    assert.match(doc, /ship\/<name>/);
  }
  assert.match(workflow, /Spec, Build, and Review activate a session-native goal/);
  assert.match(workflow, /Ship does not activate a goal/);
  for (const doc of [workflow, readme]) {
    assert.match(doc, /human prepares integration and commits/i);
    assert.doesNotMatch(doc, /Review then merges|Review owns technical convergence|Review reconstructs.*then merges/);
  }
});

test("user-wide input preference has one owner", () => {
  const user = text("AGENTS.md");
  assert.match(user, /Use `ask_user_question` whenever requesting human input/);
  for (const name of ["dev-spec", "dev-build", "dev-review", "dev-ship", "dev-explore"]) assert.doesNotMatch(skill(name), /`ask_user_question`/);
});
