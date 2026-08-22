---

name: build
description: Implement an approved implementation plan faithfully through a smaller builder model. Use when the user invokes $dev:build or asks to implement an approved plan with checkpointed commits and confirmation between checkpoints.
---

# Build

Implement the approved plan faithfully.

Treat the approved plan as the implementation specification. Do not redesign it during the build.

Your job is to translate the plan into working code, validate it, and stop at the defined checkpoints for user confirmation.

## Before implementation

1. Read the complete approved plan.
2. Inspect the current repository state and the files and symbols named by the plan.
3. Confirm that the repository still matches the assumptions in the approved plan.
4. Identify the next implementation checkpoint.
5. Implement only that checkpoint.

Do not silently reinterpret the plan based on what you would prefer to build.

## Plan fidelity

The approved plan is authoritative for:

* architecture;
* ownership;
* APIs;
* state representation;
* concurrency;
* lifecycle;
* protocol semantics;
* compatibility behavior;
* performance-sensitive decisions;
* scope.

You may independently choose routine implementation details when they preserve the plan exactly.

Examples include:

* local variable names;
* mechanical code movement;
* equivalent internal expressions;
* formatting;
* straightforward error plumbing;
* test organization.

Do not introduce new architectural decisions merely because they make implementation easier.

## Deviation gate

If repository investigation or implementation reveals that the approved plan cannot be followed as written, stop before deviating and ask the user.

This includes:

* the repository materially differs from what the plan describes;
* a named symbol or assumed behavior no longer exists;
* two materially different implementations would produce different semantics;
* one plan requirement conflicts with another;
* the planned architecture cannot work as specified;
* additional scope is required;
* a stated invariant would need to change;
* you believe the plan should be redesigned.

When this happens, report:

1. the relevant approved-plan requirement;
2. what you discovered;
3. why continuing would require deviation;
4. the smallest meaningful options.

Do not select an option or modify the plan yourself.

Do not implement the deviation and disclose it afterward.

## Checkpoints

Follow the checkpoints defined by the approved plan.

For each checkpoint:

1. Implement the complete checkpoint.
2. Remove obsolete code required by that checkpoint.
3. Run the checkpoint's specified validation.
4. Inspect the resulting diff for unintended changes.
5. Verify the checkpoint against the approved plan.
6. Create one focused descriptive commit.
7. Report:

   * what changed;
   * important files or symbols;
   * validation performed;
   * commit hash and subject;
   * any observations relevant to later checkpoints.
8. Stop and ask the user to confirm before continuing.

Do not begin the next checkpoint without explicit user confirmation.

If a checkpoint is too large to form one coherent commit, stop and ask before changing the checkpoint structure rather than silently repartitioning the approved plan.

## Commits

Create descriptive commits representing coherent completed states.

Commit messages should describe the architectural or behavioral change, not the editing activity.

Prefer:

`refactor(routing): move forwarding ownership into participant`

over:

`update routing files`

Do not mix unrelated cleanup into checkpoint commits.

Do not amend, squash, reorder, or rewrite earlier checkpoint commits unless the user asks.

## Scope discipline

Implement only what the approved plan requires.

Do not:

* perform opportunistic cleanup;
* generalize for hypothetical future requirements;
* add compatibility shims not specified by the plan;
* preserve obsolete machinery the plan says to remove;
* redesign adjacent components;
* fix unrelated issues discovered along the way.

If unrelated work is worth mentioning, report it without implementing it.

## Validation

Passing tests is necessary but not sufficient.

At each checkpoint, compare the actual diff to the checkpoint specification.

Before final completion:

1. Re-read the entire approved plan.
2. Verify every acceptance criterion.
3. Verify every invariant.
4. Confirm required removals actually occurred.
5. Confirm no unapproved scope or behavior was introduced.
6. Run the complete final verification from the plan.
7. Inspect the final commit range against the pre-build state.

If the implementation differs materially from the approved plan, invoke the deviation gate rather than declaring completion.

## Completion

After the final checkpoint is confirmed, report:

* completed checkpoints and commits;
* acceptance criteria satisfied;
* final validation results;
* any remaining explicitly planned follow-up work.

Do not claim completion merely because the repository builds or tests pass.
