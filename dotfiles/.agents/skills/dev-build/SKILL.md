---
name: dev-build
description: Implement exactly one approved numbered plan quickly, robustly, and minimally; verify it, create one coherent commit when code changes, and stop. Requires an exact plan path.
---

# Dev Build

Implement exactly one numbered plan as a senior software engineer. Do not redesign the project, review another commit, continue into another plan, or spawn subagents.

`plans/` is Git-ignored local workflow state. Access it directly through the filesystem; never use Git to discover, inspect, validate, stage, or commit its contents.

Use the exact plan’s `Implementation handoff` as the primary repository navigation map. Treat its facts as pointers to confirm, not as substitutes for repository evidence.

Do not read sibling numbered plans unless the exact plan names one as a dependency and a concrete implementation question requires it.

## Engineering standard

- Derive truth from the exact plan, its relevant spec sections, the current request, repository instructions, architecture, code, tests, and real or intended callers.
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
- Reuse planner-provided repository anchors before searching. Do not independently rediscover settled ownership or architecture unless named evidence is stale, incomplete, ambiguous, or contradicted by the current tree.
- Minimize context and tool use. Batch related work, avoid repeated evidence, and keep diagnostics concise.
- Do not rely on compaction. If the work no longer fits one bounded outcome, stop and return to planning.

## 1. Establish the contract

Require one exact `plans/<project>/<NN>-*.md` path. Reject an omitted path, directory, ambiguous match, or `next`.

Before editing:

1. Read the exact plan directly from `plans/`.
2. Read only the sections of sibling `spec.md` named under the plan’s `Implementation handoff`.
3. Read only relevant repository instructions and architecture named by the plan or required by the named implementation anchors.
4. Inspect version-control state and preserve unrelated production work.
5. In one grouped pass, confirm the named canonical owner, starting points, direct callers, relevant tests, and completeness searches.
6. Use those anchors to confirm the relevant data flow, lifecycle, failure paths, cleanup, and existing evidence.
7. Derive a private acceptance checklist.

Read additional sections of `spec.md`, additional unchanged production code, or broader repository search results only when needed to answer a concrete unresolved implementation question.

If the plan predates the `Implementation handoff` section, read the sibling spec once and perform one focused repository discovery pass. Record the missing handoff under `Deviations` in the build evidence. Do not compensate by reading sibling numbered plans or performing a broad repository inventory.

If the plan path does not exist, stop and report it.

If a named handoff anchor is stale or wrong, inspect only enough surrounding evidence to determine whether the plan remains valid.

If repository reality or a new user correction materially contradicts the plan or requires a consequential new decision, stop and return to `dev-plan`. Do not silently redesign during implementation.

If existing behavior already satisfies the plan, prove it, write the build evidence, report that no change is required, and stop without creating a commit.

## 2. Implement quickly

Build the minimum complete solution.

- Start from the plan’s named implementation anchors.
- Gather related evidence before editing.
- Batch related searches, reads, edits, and checks.
- Read named starting points, callers, and tests in grouped operations rather than one file or symbol per turn.
- Avoid broad discovery and whole-file or whole-log dumps when targeted evidence is sufficient.
- Do not reread unchanged content or rerun unchanged commands without a concrete reason.
- Do not repeat repository investigation already captured by the handoff unless the current tree contradicts it.
- Before broadening a search, identify the concrete unresolved question privately and stop searching when it is answered.
- Do not inspect sibling plans or future milestones merely for context.
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
- Run or inspect the plan’s named completeness searches once against the final tree when applicable.
- Confirm every named in-scope caller or consumer is handled.

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

## 6. Commit, write the handoff, and stop

If production code changed, create one coherent Conventional Commit containing only this plan’s implementation.

Include:

`Dev-Plan: plans/<project>/<NN>-<outcome>.md`

Inspect the final commit and worktree.

Write or replace a compact build-evidence file beside the plan by replacing the plan’s `.md` suffix with `.build.md`:

`plans/<project>/<NN>-<outcome>.build.md`

Write the build evidence whenever the exact plan was successfully read, including completed, no-change, blocked, or requires-replanning outcomes.

Use:

```markdown
# Build evidence

Plan: plans/<project>/<NN>-<outcome>.md
Base revision: <starting revision>
Commit: <final commit, current revision, or none>
Status: COMPLETED | NO CHANGE | BLOCKED | REQUIRES REPLANNING

## Changed paths

- `<path>` — <one-line purpose>

None.

## Verification

- `<exact command or evidence>` — PASS
- `<exact command or evidence>` — FAIL: <concise reason>
- `<exact command or evidence>` — NOT RUN: <concise reason>

## Deviations

None.
```

Include only applicable entries. Do not include reasoning transcripts, command logs, copied diffs, broad repository summaries, or speculative follow-up work.

The build evidence is navigation for a fresh reviewer. It does not replace independent review of the plan, repository, diff, and tests.

Report only:

- **Changed**
- **Verified**
- **Commit**, or **No commit** when no change was required
- **Handoff**
- **Notes**, only when material

Then stop.
