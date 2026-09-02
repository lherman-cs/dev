---
name: dev-review
description: Independently review one completed plan and commit in a fresh session, fix confirmed material findings, verify the result, and leave one reviewed commit. Use after dev-build
---

# Dev Review

Review one completed implementation as an independent senior engineer.

This skill runs in a fresh dedicated review session. Do not inherit or
reconstruct the builder's reasoning. Judge the committed result from the
repository, contract, evidence, and diff.

Do not spawn subagents. Do not begin the next numbered plan.

## Establish the review target

Resolve:

1. the commit to review, normally `HEAD`;
2. the numbered plan implemented by that commit;
3. the sibling project `spec.md`;
4. ownership README and architecture documentation for directly affected
   modules.

Inspect `git status` before making changes.

Preserve unrelated user work.

Begin with the committed diff rather than broad repository exploration.

The goal is not to reproduce the implementation process. The goal is to decide
whether the resulting artifact is correct, complete, simple, and faithful to
its contract.

## Review independently

Assume neither that the implementation is correct nor that it is wrong.

Try to falsify it.

Review in this priority order.

### 1. Contract completeness

Compare the final tree directly against:

* the numbered plan outcome;
* required scope;
* constraints;
* verification requirements;
* applicable project-spec behavior and invariants.

Look for work that was claimed but not actually implemented.

Passing tests are not sufficient evidence of completeness.

### 2. Architecture and ownership

Check that the implementation follows authoritative repository boundaries.

Look for:

* responsibility in the wrong module;
* duplicated policy;
* hidden shared state;
* platform logic leaking across boundaries;
* generated-vs-handwritten ownership violations;
* lifecycle or resource ownership mistakes;
* stale paths left active after migration;
* public API expansion not required by the contract.

Do not reopen a settled architectural decision merely because another design
is aesthetically preferable.

Raise architecture findings only when the implementation violates the accepted
contract, creates a concrete correctness/maintenance problem, or repository
evidence shows the contract itself is wrong.

### 3. Correctness and failure semantics

Inspect behavior on both success and failure paths.

Pay particular attention where relevant to:

* stale or duplicate events;
* ordering;
* cancellation;
* retries;
* partial failure;
* cleanup;
* resource lifetime;
* idempotency;
* boundary validation;
* concurrency;
* unsafe code;
* protocol state;
* malformed external input;
* error propagation.

Trace only the call sites needed to evaluate a concrete risk.

### 4. Simplicity

Look for unnecessary implementation surface:

* abstractions with only speculative value;
* duplicated state;
* redundant compatibility layers;
* handwritten glue that should be generated;
* unnecessary dependencies;
* dead displaced implementation;
* complexity not required by the plan.

Prefer removing unnecessary machinery over adding another layer around it.

Do not turn review into an unrelated cleanup project.

### 5. Evidence quality

Evaluate whether the tests and validation actually prove the claimed behavior.

Ask:

* does the test exercise the real boundary?
* would the test fail if the important behavior were broken?
* is an internal mock being used where independent interoperability is the
  actual contract?
* are failure and cleanup paths meaningfully covered?
* was an oracle weakened to accommodate the implementation?

Do not demand exhaustive testing when narrow evidence convincingly proves the
plan.

## Keep review targeted

Start from:

`git show --stat`
`git show`

or repository equivalents, then inspect surrounding code only where the diff
creates a concrete question.

Prefer several focused searches or reads over broad repository dumps.

Keep command output concise.

Do not rerun the builder's entire investigation.

Do not spend tokens proving obvious unchanged code correct.

Do not investigate future plans or unrelated existing defects except when they
directly affect the validity of this commit.

## Classify findings

Only material findings should block acceptance.

A material finding is one that affects:

* correctness;
* required behavior;
* architecture or ownership;
* reliability;
* security;
* interoperability;
* significant unnecessary complexity;
* the validity of acceptance evidence.

Do not churn code for naming taste, stylistic preference, speculative
generalization, or unrelated cleanup when repository conventions already
accept the implementation.

For each suspected material issue, verify it against concrete repository
evidence before changing code.

## Fix confirmed findings

When a material finding has a clear correct fix within the reviewed plan's
scope, fix it in this review session.

Keep corrections tightly scoped to the reviewed plan.

Add or update regression evidence when needed.

If fixing a finding requires a consequential architecture decision outside the
approved plan, do not invent that decision. Report the contradiction and
return the project to `$dev-plan`.

Do not begin adjacent improvements while fixing review findings.

## Verify the reviewed result

After all confirmed material findings are fixed:

1. Re-read the plan and relevant project invariants.
2. Re-inspect the final scoped diff.
3. Run the narrowest tests needed for review fixes.
4. Run the plan's required final validation on the unchanged tree.
5. Run broader repository gates once when required.
6. Confirm no material review finding remains.
7. Confirm unrelated user changes were preserved.

Do not repeatedly run successful gates without a concrete reason.

## Finalize the commit

If review made changes, amend the reviewed commit when it is safe and
consistent with the requested workflow.

Do not create a second feature commit merely to record review corrections to
the same plan unless repository policy requires it.

If no material changes are needed, leave the commit unchanged.

## Handoff

Report only:

* **Result** — accepted, corrected and accepted, or requires replanning.
* **Findings** — material findings only.
* **Verified** — final evidence.
* **Commit** — final hash and subject.
* **Notes** — only material remaining risks or known external baseline
  failures.

Then stop.

Do not begin the next numbered plan.
