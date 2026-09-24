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
  ]) assert.match(spec, requirement);
});

test("three stage contracts keep approval, local review, and history ownership distinct", () => {
  assert.match(skill("dev-spec"), /explicit human approval/);
  assert.match(skill("dev-build"), /approval of the outcome must be established/);
  assert.match(skill("dev-build"), /explicit conversational approval/);
  assert.match(skill("dev-build"), /obtain it before implementation/);
  assert.match(skill("dev-build"), /Diagnose uncertain or interrupted writes from live state/);
  assert.match(skill("dev-ship"), /fixed local comparison base and exact candidate scope/);
  const ship = skill("dev-ship");
  assert.ok(ship.indexOf("**Open with a living review brief.**") < ship.indexOf("**Review the settled candidate.**"));
  assert.ok(ship.indexOf("**Review the settled candidate.**") < ship.indexOf("**Confirm, then refine.**"));
  for (const requirement of [
    /compact, decision-ready engineering assessment/, /practical outcome/, /why consequential choices fit the problem/,
    /how important failures would affect users or operations/, /what supporting evidence establishes and leaves uncertain/,
    /do not substitute mechanism names or a list of passing gates/, /Scale depth to the change/,
    /verified facts, assumptions, and unknowns/, /without reconstructing the diff/,
    /Follow the human's questions or redirects/, /without restarting a tour/,
    /resurface consequential ones before closing/, /Ask only when a real decision requires human input/,
    /Do not create routine continuation prompts or section-by-section checkpoints/,
    /Fix clear in-scope defects directly/, /Discuss consequential changes .* before implementing them/,
    /report material changes to behavior, risk, evidence, or the assessment/,
    /Keep routine execution status and disposition bookkeeping subordinate/, /translate checks into the behavior they support without overstating their assurance/,
    /Reopen an earlier decision only when new evidence or changes materially affect its premise/,
    /single broad `review` on the stable agreed candidate/,
    /one batched result/, /concrete closure checks/, /discloses unexamined coverage/,
    /The Shipper owns routine finding closure/, /one repair audit only/,
    /obtain human permission first/, /cannot create an audit loop/, /durable review receipts/, /A resumed session alone does not justify repeating a reviewer launch/,
    /Material repairs invalidate affected validation/, /consolidated brief for the actual resulting candidate/,
    /started review that fails or yields no usable assessment leaves an independent-scrutiny gap/, /Passing checks cannot replace independent scrutiny/,
    /present that decision separately with consequences and a supported recommendation/, /Do not retry a consumed slot/,
    /Explicitly ask the human whether they are satisfied with the resulting local review and authorize local commit cleanup/,
    /does not authorize integration or deployment/, /Silence or cancellation is not approval/, /do not .*bundle acceptance of a material evidence gap/,
    /Only then create a recoverable pre-cleanup reference/, /verify tree equivalence/,
    /History-only changes preserving the reviewed tree do not require another human approval/,
    /Do not fetch, push, mutate remote review state, or merge/,
  ]) assert.match(ship, requirement);
  assert.doesNotMatch(ship, /topic at a time|walkthrough pauses|`ask_user_question`|re-review interactions/);
  assert.match(skill("dev-review"), /immutable read-only snapshot/);
  assert.match(skill("dev-review"), /settled uncommitted candidate content/);
  assert.match(text("references/reconcile.md"), /except for dev-ship's explicitly bounded cleanup/);
  assert.doesNotMatch(skill("dev-ship"), /PR readiness|mandatory reviewer|ship_builder/i);
});

test("user-wide input preference has one owner and skills retain phase decisions", () => {
  const user = text("AGENTS.md");
  for (const request of ["clarification", "preferences", "decisions", "permission", "approval"]) assert.match(user, new RegExp(request));
  assert.match(user, /Use `ask_user_question` whenever requesting human input/);
  assert.match(user, /Do not solicit input only in prose/);
  assert.match(user, /Explanations and status updates remain ordinary messages; do not add unnecessary questions/);
  for (const name of ["dev-spec", "dev-build", "dev-ship", "dev-review", "dev-explore"]) {
    assert.doesNotMatch(skill(name), /`ask_user_question`/);
  }
  assert.match(skill("dev-spec"), /Ask one focused question at a time, ordered by decision leverage/);
  assert.match(skill("dev-spec"), /explicit human approval/);
  assert.match(skill("dev-ship"), /obtain human permission first/);
  assert.match(skill("dev-ship"), /Explicitly ask the human whether they are satisfied with the resulting local review/);
});

test("ship documentation describes living review and the bounded hybrid review protocol", () => {
  const workflow = readFileSync(fileURLToPath(new URL("../../WORKFLOW.md", import.meta.url)), "utf8");
  const readme = readFileSync(fileURLToPath(new URL("../../README.md", import.meta.url)), "utf8");
  assert.match(workflow, /compact engineering assessment/);
  assert.match(workflow, /why consequential choices fit/);
  assert.match(workflow, /Treat a material independent-review failure as a separate risk decision/);
  assert.match(workflow, /not to integrate or deploy/);
  assert.match(workflow, /tracking unresolved concerns/);
  assert.match(workflow, /present the consolidated assessment and seek explicit human authorization/);
  assert.match(workflow, /one broad-review slot and one repair-audit slot/);
  assert.match(workflow, /one batch of findings with closure checks/);
  assert.match(workflow, /Repairs do not automatically relaunch review/);
  assert.match(workflow, /obtains human permission/);
  assert.match(workflow, /cannot trigger another audit/);
  assert.match(workflow, /persist with the ship effort across session recovery/);
  assert.match(workflow, /five-minute deadline/);
  assert.match(readme, /concise engineering assessment/);
  assert.match(readme, /discussion follows the human's questions rather than a fixed tour/);
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
