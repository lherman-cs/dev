---
name: dev-build
description: Implement one approved plan from plans/<project>/<NN>-*.md in the current thread through completion and verify it without reopening approved architecture. Use only when explicitly invoked with a project and plan number or plan path.
---

# Dev Build

Implement one approved plan completely in the current thread.

The plan owns intent, scope, architecture, and acceptance criteria.
This phase owns implementation mechanics and verification.

A build run is not complete until the plan's implementation and verification
requirements are satisfied, or a genuine plan/spec blocker is identified.

## Resolve

Accept:

- `project/NN`
- `plans/project/NN-name.md`

Resolve exactly one plan and read it first.

Reuse relevant session and repository context already established.
Do not repeat `dev-plan` investigation.

Read the sibling `spec.md` only when:

- the plan is materially ambiguous; or
- repository reality appears to contradict the plan.

Before implementation, identify the plan's required changes and verification
criteria so completion can be checked explicitly.

## Implement

Work only within the approved plan.

1. Inspect affected code and nearby dependencies as needed.
2. Prefer plan facts over re-deriving architecture or implementation strategy.
3. Follow existing repository conventions for local mechanics.
4. Make the smallest coherent changes that satisfy the plan.
5. Resolve cheap implementation details directly.
6. Avoid unrelated cleanup or opportunistic refactors.
7. Continue until every required part of the plan is implemented.

Do not:

- expand scope;
- reconsider approved architecture;
- weaken requirements;
- modify the plan or spec to justify the implementation;
- broadly reinvestigate the repository;
- stop merely because the remaining implementation is large, difficult, or
  spans several related changes;
- treat compilation or an intermediate passing check as plan completion.

Minor mechanical deviations are allowed when repository reality requires them
and the approved design remains unchanged.

When one change exposes another change already implied by the plan, continue
the cutover rather than stopping at the intermediate state.

## Completion Contract

Partial implementation is not a valid final result.

Do not end the build with statements such as:

- "Plan NN is in progress";
- "the remaining cutover is substantial";
- "I have begun the next phase";
- "the workspace currently compiles";
- "the rest must be replaced together".

Those are progress observations, not terminal outcomes.

After an intermediate check or progress update, continue implementing the plan.

Before producing the final response:

1. Re-read the plan.
2. Check every planned change and acceptance criterion against repository state.
3. Complete anything still missing.
4. Run the required final verification.
5. Only then report success.

The only valid reasons to finish without completing the plan are:

- a plan issue;
- a spec issue;
- an external/tooling blocker that makes further implementation impossible.

Difficulty, implementation size, newly discovered local work, or context already
spent are not blockers by themselves.

## Verify

Run:

- verification required by the plan;
- cheap checks directly implied by the changes.

Fix implementation-caused failures and rerun relevant checks.

Verification should establish changed behavior, not merely compilation.

Passing verification of an intermediate state does not imply that the plan is
complete.

Before declaring success, verify both:

- all planned implementation is present;
- all required verification passes on the completed implementation.

## Escalate

Escalate only when continuing would require changing an approved design or
requirement.

Classify the problem:

- **build issue** — local implementation is wrong or more work is required;
  fix it here and continue;
- **plan issue** — the approved implementation strategy or decomposition cannot
  satisfy the plan without materially changing it; return to `dev-plan`;
- **spec issue** — the approved destination, architecture, invariant, or
  requirement is materially wrong; return to `dev-spec`;
- **external blocker** — required tooling, dependency, environment, or access
  prevents further work; report the exact blocker and evidence.

Do not classify implementation complexity, a large remaining cutover, failing
tests caused by the current implementation, or additional work already implied
by the plan as plan/spec issues.

Do not solve genuine plan or spec problems inside build.

## Progress

Progress updates are allowed when useful, but they are never terminal.

Keep them concise and immediately continue implementation afterward.

Do not replace implementation work with a progress summary.

## Output

Optimize output for user review.

On success, report only:

- **Changed** — concise implementation outcome;
- **Verified** — commands/checks and results;
- **Notes** — only material deviations or remaining risks.

On escalation, report only:

- **Blocked** — exact blocking assumption or contradiction;
- **Evidence** — repository/tool evidence establishing it;
- **Return to** — `dev-plan` or `dev-spec`, when applicable.

Omit:

- implementation narration;
- files touched unless useful;
- reasoning already captured by the plan;
- successful intermediate steps;
- generic summaries.

Never report "in progress" as the final outcome.

Do not claim success without fresh verification.

If creating a commit, create it only after the plan is complete and verified.

Include:

`Plan: plans/<project>/<NN>-<name>.md`
