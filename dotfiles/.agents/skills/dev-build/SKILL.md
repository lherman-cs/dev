---
name: dev-build
description: Implement exactly one approved numbered plan quickly, robustly, and minimally; verify it, create one coherent commit when code changes, and stop. Requires an exact plan path.
---

# Dev Build

Implement exactly one numbered plan as a senior software engineer. Do not redesign the project, review another commit, continue into another plan, or spawn subagents.

`plans/` is Git-ignored local workflow state. Access it directly through the filesystem; never use Git to discover, inspect, validate, stage, or commit its contents.

## Engineering standard

- Derive truth from the exact plan, its spec, the current request, repository instructions, architecture, code, tests, and real or intended callers.
- Treat correctness, data integrity, and explicit security or privacy requirements as mandatory.
- Among otherwise valid implementations, prioritize:
  1. Robustness
  2. Simplicity
  3. Scalability
  4. Performance
  5. Security
- Prefer, in order:
  1. no change;
  2. reuse existing behavior;
  3. extend the canonical owner;
  4. use standard, native, or already-adopted mechanisms;
  5. reuse an existing dependency;
  6. add the least custom machinery that completely satisfies the requirement.
- Every new abstraction, layer, state, dependency, option, compatibility path, or extension point must satisfy a current requirement or enforce a proven boundary.
- Keep one canonical owner and source of truth.
- Prefer direct data flow, small deep interfaces, conventional names, and obvious control flow.
- Fix root causes, not symptoms.
- Minimize context and tool use. Batch related work, avoid repeated evidence, and keep diagnostics concise.
- Do not rely on compaction. If the work no longer fits one bounded outcome, stop and return to planning.

## 1. Establish the contract

Require one exact `plans/<project>/<NN>-*.md` path. Reject an omitted path, directory, ambiguous match, or `next`.

Before editing:

1. Read the exact plan and sibling `spec.md` directly from `plans/`.
2. Read only relevant repository instructions and architecture.
3. Inspect version-control state and preserve unrelated production work.
4. Trace the relevant callers, canonical owner, data flow, lifecycle, failure paths, cleanup, and existing evidence.
5. Derive a private acceptance checklist.

If the plan path does not exist, stop and report it.

If repository reality or a new user correction materially contradicts the plan or requires a consequential new decision, stop and return to `dev-plan`. Do not silently redesign during implementation.

If existing behavior already satisfies the plan, prove it, report that no change is required, and stop without creating a commit.

## 2. Implement quickly

Build the minimum complete solution.

- Gather related evidence before editing.
- Batch related searches, reads, edits, and checks.
- Avoid broad discovery and whole-file or whole-log dumps when targeted evidence is sufficient.
- Do not reread unchanged content or rerun unchanged commands without a concrete reason.
- Keep full diagnostics on disk and bring only relevant excerpts into context.
- Avoid speculative abstractions, wrappers, duplicated or derivable state, dependencies, configuration, compatibility, and future-proofing.
- Do not add public surface without a current in-scope caller or explicit contract.
- Follow the change through required callers, failure paths, cleanup, tests, and removal of displaced in-scope code.
- Do not perform adjacent cleanup.

Prefer fewer concepts and failure modes, not fewer characters. Keep behavior complete and locally understandable.

## 3. Debug from evidence

Use:

`reproduce → hypothesis → discriminating evidence → root cause → fix → regression evidence`

- Run the cheapest check that can distinguish the current hypothesis.
- Do not repeat an unchanged failing command.
- Do not apply speculative patches.
- After two failed hypotheses for the same symptom, stop editing and re-establish the root cause from the smallest useful reproducer, trace, or diagnostic.
- Return to planning when the approved design is wrong.

## 4. Validate economically

Assume tests are slow and expensive.

Before an expensive command, identify what it will prove and how each outcome changes the next action. Do not run it when neither outcome is actionable.

While iterating:

1. Use static reasoning to choose the next check.
2. Run the narrowest check that can falsify the current change.
3. Prefer focused tests before integration or repository-wide suites.
4. Use the real external boundary when the contract requires interoperability.
5. Do not rerun a successful expensive check on an unchanged relevant tree.
6. Run required final validation once on the unchanged final tree.

Never weaken tests, invariants, thresholds, or requirements merely to get green.

Treat a failure as pre-existing only when the starting state or durable evidence proves it.

## 5. Audit the result

### Correctness

- Map every plan requirement to code and evidence.
- Inspect important success, failure, boundary, lifecycle, concurrency, and cleanup behavior.
- Confirm the implementation fully satisfies the plan.

### Simplicity and readability

Read every human-written changed line.

Remove unnecessary:

- abstractions;
- wrappers;
- indirection;
- duplicated or derivable state;
- dependencies;
- configuration;
- compatibility paths;
- public surface;
- comments compensating for unclear code;
- dead or displaced paths.

Confirm every remaining mechanism satisfies a current requirement or proven boundary.

Keep the code obvious, robust, conventional, and maintainable.

Inspect the complete scoped production diff and run `git diff --check` or the repository equivalent.

## 6. Commit and stop

If production code changed, create one coherent Conventional Commit containing only this plan's implementation.

Include:

`Dev-Plan: plans/<project>/<NN>-<outcome>.md`

Inspect the final commit and worktree.

Report only:

- **Changed**
- **Verified**
- **Commit**, or **No commit** when no change was required
- **Notes**, only when material

Then stop.
