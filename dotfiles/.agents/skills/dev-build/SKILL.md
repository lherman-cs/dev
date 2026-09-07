---
name: dev-build
description: Implement exactly one approved numbered plan, address current review findings, verify it, commit it, write compact evidence, and stop.
---

# Dev Build

Implement exactly one supplied numbered plan. The plan is the contract.

Do not redesign the project, continue into another plan, or broadly rediscover the repository.

Require one exact plan path. `plans/` is Git-ignored workflow state.

## Explorer

Delegate unresolved repository investigation to `explorer` whenever answering the concrete question requires more than one search or source read.

Do not use `explorer` to rediscover facts already settled by the plan's verified preconditions or repository handoff.

Always spawn with `agent_type="explorer"` and `fork_turns="none"`.

Give it:
- one self-contained unresolved repository question;
- the narrowest known scope;
- relevant plan anchors, paths, symbols, callers, tests, or failure evidence;
- the exact fact needed to continue implementation.

Do not perform the same investigation in the parent thread.

The parent may directly:
- read files and symbols explicitly named by the plan;
- follow one obvious caller, failure path, or test;
- inspect code identified by the explorer;
- perform targeted verification of an explorer finding.

If investigation expands into multiple searches or source reads, delegate it instead of continuing repository discovery in the parent.

Reuse the explorer for related follow-ups; do not repeat its searches.

Explorer gathers unresolved repository facts. You implement.

## Workflow

1. **Establish**

   * Read the exact plan and applicable repository instructions.
   * Inspect version-control state.
   * Start from its verified preconditions and repository handoff.
   * Do not reread `spec.md`, sibling plans, or dependency plans.
   * Do not revalidate settled facts unless the current tree contradicts them.
   * If resolving a contradiction requires multi-step repository investigation, delegate it to `explorer`.

   If a verified precondition or material plan assumption is false: `REQUIRES REPLANNING`.

   If a matching `.review.md` targets current `HEAD` with `CHANGES REQUIRED`, treat its findings as additional acceptance obligations.

2. **Implement**

   * Build the minimum complete solution.
   * Follow only required callers, failure paths, cleanup, tests, and displaced in-scope code.
   * Batch related reads, edits, and checks.
   * Avoid adjacent cleanup and speculative machinery.
   * Do not repeat unchanged searches, reads, or commands.
   * When an unresolved implementation question requires multiple searches or source reads, delegate it to `explorer` rather than broadly investigating in the parent.

   If implementation requires a consequential decision absent from the plan: `REQUIRES REPLANNING`.

3. **Debug**

   * Use `reproduce → hypothesis → evidence → root cause → fix`.
   * Run the smallest discriminating check.
   * Delegate multi-file root-cause investigation to `explorer`; keep direct parent investigation to narrow hypotheses and targeted reads.
   * Do not repeat unchanged failures or apply speculative patches.
   * Environment/tooling failures are not implementation work. Use only an obvious local correction; otherwise: `BLOCKED`.
   * Never create alternate clones/worktrees or manually replace authoritative generated output to bypass a blocker.

4. **Verify**

   * Prove every acceptance item and current review finding.
   * Prefer focused checks while iterating.
   * Run required final acceptance/completeness checks once on the final tree.
   * Inspect the complete scoped diff and run `git diff --check` or equivalent.

5. **Commit**

   * If code changed, create one coherent Conventional Commit containing only this plan.
   * Describe the repository change, not workflow state.

6. **Handoff**

   * Write `plans/<project>/<NN>-<outcome>.build.md`:

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

Keep it factual and compact. Then report status and stop.
