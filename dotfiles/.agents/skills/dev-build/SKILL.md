---
name: dev-build
description: Implement exactly one approved numbered plan, address current review findings, verify it, commit it, write compact evidence, and stop.
---

# Dev Build

Implement exactly one supplied numbered plan. The plan is the contract.

Do not redesign the project, continue into another plan, or broadly rediscover the repository.

Require one exact plan path. `plans/` is Git-ignored workflow state.

## Main-thread boundary

Preserve the parent for understanding the contract, implementation decisions, source editing, focused verification, and final handoff. Keep repository orientation and tracing out of its context.

The parent may directly consume only:
- the exact numbered plan and applicable repository instructions;
- current review findings when present;
- compact explorer findings;
- exact source regions it must modify;
- focused verification results;
- human-authored diff hunks needed to validate its changes.

Do not make the parent reconstruct architecture, caller graphs, patterns, lifecycle paths, or test surfaces from raw repository reads.

After reading the exact plan, spawn `explorer` before any broad repository orientation.

## Explorer

Use `explorer` as the primary repository context owner for implementation support.

Spawn with `agent_type="explorer"` and `fork_turns="none"`.

Prefer one primary explorer for related questions and continue with it when follow-ups depend on existing evidence. Spawn another only for independent investigation without substantial overlap.

Give it the exact plan path and ask it to locate only evidence required to execute that contract:
- exact edit surfaces and surrounding invariants;
- canonical implementation patterns;
- callers/consumers that must move with the change;
- lifecycle, failure, cleanup, and concurrency paths;
- relevant tests, fixtures, and verification commands;
- contradictions between the plan and current tree.

Require a compact answer with direct conclusions, `path::symbol` evidence, important relationships, and material uncertainty.

Do not ask it to choose product behavior, architecture, or implementation strategy. The explorer gathers facts; the parent implements.

Do not duplicate its tracing in the parent. Read only returned source regions required to edit or verify behavior.

For debugging, keep the hypothesis and fix decision in the parent; use the same explorer for read-heavy tracing and large failure-output analysis.

If `explorer` is unavailable, use only narrow direct reads required to continue. Broad parent-side discovery is not an allowed fallback.

## Workflow

1. **Establish**
   * Read the exact plan and applicable repository instructions once.
   * Inspect version-control state.
   * Start from verified preconditions and the repository handoff.
   * Do not reread `spec.md`, sibling plans, or dependency plans.
   * Do not revalidate settled facts without contradictory evidence.
   * Spawn the primary explorer before non-local repository investigation.

   If a verified precondition or material assumption is false: `REQUIRES REPLANNING`.

   If a matching `.review.md` targets current `HEAD` with `CHANGES REQUIRED`, treat its findings as additional acceptance obligations.

2. **Implement**
   * Build the minimum complete solution.
   * Use explorer findings to narrow reads to source regions that must change.
   * Follow only required callers, failure paths, cleanup, tests, and displaced in-scope code.
   * Batch related reads, edits, and checks.
   * Avoid adjacent cleanup and speculative machinery.
   * Do not repeat unchanged searches, reads, or commands.
   * Keep tracing in the explorer; keep edits and implementation decisions in the parent.

   If implementation requires a consequential decision absent from the plan: `REQUIRES REPLANNING`.

3. **Debug**
   * Use `reproduce → hypothesis → evidence → root cause → fix`.
   * Run the smallest discriminating check first.
   * Delegate cross-file diagnosis or large output to the primary explorer.
   * Stop when root cause is established.
   * Do not repeat unchanged failures or apply speculative patches.
   * For environment/tooling failures, use only an obvious local correction; otherwise: `BLOCKED`.
   * Never create alternate clones/worktrees or replace authoritative generated output to bypass a blocker.

4. **Verify**
   * Prove every acceptance item and current review finding.
   * Prefer focused, quiet checks while iterating.
   * Run required final acceptance/completeness checks once on the final tree.
   * Delegate noisy failure-output analysis and non-local completeness tracing to `explorer`.
   * Inspect human-authored changed hunks directly; delegate large/generated diff completeness checks when they would add bulk context without improving parent judgment.
   * Run `git diff --check` or equivalent.
   * Repeat a successful check only if later changes could invalidate it.

5. **Commit**
   * If code changed, create one coherent Conventional Commit containing only this plan.
   * Describe the repository change, not workflow state.

6. **Handoff**

Write `plans/<project>/<NN>-<outcome>.build.md`:

```markdown
# Build evidence
Plan: <path>
Base revision: <revision>
Commit: <revision or none>
Status: COMPLETED | NO CHANGE | BLOCKED | REQUIRES REPLANNING

## Changed paths
- `<path>` — <purpose>

## Verification
- `<evidence>` — PASS | FAIL: <reason> | NOT RUN: <reason>

## Deviations
None.
```

Keep it factual and compact. Report status and stop.
