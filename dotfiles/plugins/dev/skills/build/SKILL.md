---
name: build
description: Implement and validate a self-contained approved plan in an existing repository. Use when the user invokes $dev:build or explicitly asks to execute a previously approved implementation plan. Do not use when consequential design remains unresolved or no approved plan exists.
---

# Build

Implement the approved plan faithfully. Treat it as authoritative for consequential behavior and use engineering judgment for local, behaviorally equivalent details.

Work in the current agent. Do not spawn another implementation agent merely to repeat the plan.

## Normalize the inputs

Recover this contract:

1. **Task** — the complete approved plan and acceptance criteria.
2. **References** — repository path, plan baseline, and relevant build context.
3. **Constraints and non-goals** — approved deviations, behavior to preserve, excluded work, and any requested commit policy.

Infer routine context from the conversation and repository. If the approved plan is absent or not self-contained, stop and request the missing plan or decision rather than designing during implementation.

## Preflight

Before editing:

- read the complete plan and applicable repository instructions;
- inspect repository status, baseline, named files, symbols, and tests;
- confirm the plan still matches the code;
- protect unrelated and user-authored changes.

Invoke the deviation gate before editing when the baseline is materially stale, in-scope work conflicts with user changes, or the plan cannot be followed as written.

## Implement

Execute coherent plan checkpoints continuously:

1. Implement the planned behavior and necessary supporting changes.
2. Remove obsolete code the checkpoint replaces.
3. Run the smallest validation that exercises the changed behavior.
4. Inspect the diff for accidental scope, incomplete migration, and plan drift.
5. Continue when the repository is coherent.

Do not request confirmation after every checkpoint. Give sparse progress updates during long work and pause only for a deviation, destructive or external action, conflict with user work, or checkpoint explicitly marked for approval.

Create commits only when requested by the user or approved plan. When requested, make focused commits for coherent states without rewriting existing history or including unrelated cleanup.

## Deviation gate

Stop before changing a decision about architecture, ownership, API or protocol behavior, state, concurrency, lifecycle, compatibility, performance or security invariants, migration, or scope.

Return one compact decision packet:

- conflicting plan requirement;
- repository evidence;
- concrete impact;
- smallest viable options;
- recommendation.

Do not cross the boundary until the user decides. Continue independently for routine naming, code organization, error plumbing, and test placement when semantics remain unchanged.

## Failure and completion

Diagnose and fix defects introduced by the current work without asking. Do not rerun an unchanged failing command more than once. After two materially different failed approaches, or when evidence shows the plan is wrong, stop with the evidence and invoke the deviation gate.

Before completion, verify every acceptance criterion and invariant, required removal or migration, final validation, and the complete diff against the pre-build state. Confirm that no unapproved behavior or cleanup entered the change.

Report implemented checkpoints, material files or symbols, validation results, requested commits, and blocked or deferred work. If validation could not run, state why and the next best check; never imply success from compilation or partial tests alone.
