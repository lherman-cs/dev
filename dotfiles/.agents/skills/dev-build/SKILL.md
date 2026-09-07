---
name: dev-build
description: Implement exactly one approved numbered plan, address current review findings, verify it, commit it, write compact evidence, and stop.
---

# Dev Build

Implement exactly one supplied numbered plan. The plan is the contract.

Do not redesign the project, continue into another plan, or broadly rediscover the repository.

Require one exact plan path. `plans/` is Git-ignored workflow state.

## Context discipline

Preserve the parent thread for implementation decisions, focused source editing, verification decisions, and final handoff.

Repository orientation, search, tracing, and large-output inspection are supporting work. Offload them to `explorer` so unrelated repository context does not accumulate in the parent.

The parent should directly consume only:

* the exact numbered plan;
* applicable repository instructions;
* concise explorer findings;
* source regions it must actually modify;
* focused verification results;
* the final scoped diff.

Do not make the parent reconstruct repository architecture already represented by the plan or explorer findings.

## Explorer

Use `explorer` for read-heavy implementation support, including:

* locating exact edit surfaces;
* tracing callers and consumers;
* finding established implementation patterns;
* locating relevant tests and fixtures;
* following lifecycle, failure, cleanup, and concurrency paths;
* resolving contradictions between the plan and current tree;
* tracing a failure across multiple files;
* inspecting large diagnostic or verification output.

Spawn with `agent_type="explorer"` and `fork_turns="none"`.

Prefer one primary explorer for related implementation questions. Let it retain repository context and use it for follow-ups rather than moving that context into the parent.

Spawn another explorer only for an independent investigation that does not substantially overlap the primary explorer's context.

Give the explorer:

* one concrete repository question;
* relevant plan anchors, paths, symbols, or failure evidence;
* the exact fact needed to continue implementation.

Require a compact result containing:

* the direct answer;
* relevant `path::symbol` evidence;
* important existing patterns or relationships;
* material uncertainty.

Do not ask the explorer to make product, architecture, or implementation decisions. Do not request raw search history, large source excerpts, or speculative fixes.

The explorer gathers facts. The parent implements.

Do not duplicate explorer discovery in the parent. Read the exact returned source regions needed for editing, but do not continue broad repository exploration from them.

If `explorer` is unavailable, use only narrowly targeted direct reads needed to continue. Broad parent-side repository discovery is not an allowed fallback.

## Workflow

1. **Establish**

   * Read the exact plan and applicable repository instructions.
   * Inspect version-control state.
   * Start from the plan's verified preconditions and repository handoff.
   * Do not reread `spec.md`, sibling plans, or dependency plans.
   * Do not revalidate settled repository facts without contradictory evidence.
   * Delegate repository orientation or non-local questions to `explorer`.

   If a verified precondition or material plan assumption is false: `REQUIRES REPLANNING`.

   If a matching `.review.md` targets current `HEAD` with `CHANGES REQUIRED`, treat its findings as additional acceptance obligations.

2. **Implement**

   * Build the minimum complete solution.
   * Use explorer findings to narrow direct source reads to the regions that must be changed.
   * Follow only required callers, failure paths, cleanup, tests, and displaced in-scope code.
   * Batch related reads, edits, and checks.
   * Avoid adjacent cleanup and speculative machinery.
   * Do not repeat unchanged searches, reads, or commands.
   * Keep repository tracing in `explorer`; keep edits and implementation decisions in the parent.

   If implementation requires a consequential decision absent from the plan: `REQUIRES REPLANNING`.

3. **Debug**

   * Use `reproduce → hypothesis → evidence → root cause → fix`.
   * Run the smallest discriminating check first.
   * Keep the hypothesis and fix decision in the parent.
   * Delegate read-heavy tracing, cross-file diagnosis, or large failure-output inspection to `explorer`.
   * Continue with the same explorer when the next diagnostic question depends on context it already gathered.
   * Stop investigating when the root cause is established.
   * Do not repeat unchanged failures or apply speculative patches.
   * Environment/tooling failures are not implementation work. Use only an obvious local correction; otherwise: `BLOCKED`.
   * Never create alternate clones/worktrees or replace authoritative generated output to bypass a blocker.

4. **Verify**

   * Prove every acceptance item and current review finding.
   * Prefer focused, quiet checks while iterating.
   * Run required final acceptance/completeness checks once on the final tree.
   * If failure output is large or requires repository tracing, have `explorer` inspect and summarize it rather than repeatedly loading it into the parent.
   * Repeat a successful check only if later changes could invalidate it.
   * Inspect the complete scoped diff and run `git diff --check` or equivalent.

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
