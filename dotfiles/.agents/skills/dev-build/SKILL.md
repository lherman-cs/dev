---
name: dev-build
description: Implement exactly one approved numbered plan, address current review findings, verify it, commit it, write compact evidence, and stop.
---

# Dev Build

Implement exactly one supplied numbered plan. The plan is the contract.

Do not change approved outcomes, interfaces, ownership, behavior, constraints, or binding architecture; nonbinding implementation guidance may adapt. Do not continue into another plan or broadly rediscover the repository.

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

After reading the exact plan, identify independent evidence questions from its handoff and delegate them before broad repository orientation.

## Explorers

Use `explorer` as the repository context owner for implementation support.

Spawn with `agent_type="explorer"` and `fork_turns="none"`.

Use the smallest useful fan-out:

- one explorer for one cohesive implementation surface;
- two or three in parallel when the plan crosses independent owners/subsystems that can be investigated without substantial overlap.

Partition by coherent ownership boundary, not by "implementation", "callers", and "tests" for the same subsystem.

Explorer questions may cover:

- exact edit surfaces and surrounding invariants;
- canonical implementation patterns;
- callers/consumers that must move with the change;
- lifecycle, failure, cleanup, and concurrency paths;
- relevant tests, fixtures, and verification commands;
- contradictions between the plan and current tree.

Require each explorer to return compact factual conclusions with `path::symbol` evidence, important relationships, and material uncertainty.

Explorers report directly to the parent. Do not add a synthesis agent. Do not ask them to choose product behavior, architecture, or implementation strategy.

The parent implements. Do not duplicate explorer tracing in the parent; read only returned source regions required to edit or verify behavior.

For debugging, keep the hypothesis and fix decision in the parent. Continue an existing explorer for same-scope tracing; use a separate explorer for an independent failure surface.

If explorers are unavailable, use only narrow direct reads required to continue. Broad parent-side discovery is not an allowed fallback.

## Implementation discipline

For every change, stop at the first solution that fully satisfies the plan:

1. Do not build behavior the plan does not require.
2. Reuse an existing repository mechanism, helper, or pattern when it already fits.
3. Prefer the standard library.
4. Prefer a native language, framework, protocol, or platform capability.
5. Prefer an already-installed dependency over adding one.
6. Prefer the simplest direct expression when it remains clear.
7. Only then write the minimum new code necessary.

Understand the actual code path and invariants before choosing the solution.
Minimize the solution, not the investigation required to make it correct.

Do not trade away correctness, validation, error handling, security,
accessibility, lifecycle guarantees, or required observability for fewer lines.

## Workflow

1. **Establish**
   - Read the exact plan and applicable repository instructions once.
   - Inspect version-control state.
   - Start from verified preconditions and the repository handoff.
   - Do not reread `spec.md`, sibling plans, or dependency plans.
   - Do not revalidate settled facts without contradictory evidence.
   - Partition and delegate non-local repository questions before investigating them in the parent.

   Resolve false preconditions within the approved contract when possible; only a necessary binding-contract change or consequential unapproved decision requires `REQUIRES REPLANNING`.

   For the current matching `CHANGES REQUIRED` review supplied by the parent, fix unresolved findings or record concrete counterevidence by finding ID. The reviewer decides closure; findings do not silently expand the contract.

2. **Implement**
   - Build the minimum complete solution. Apply the implementation discipline above to every material addition.
   - Use explorer findings to narrow reads to source regions that must change.
   - Follow only required callers, failure paths, cleanup, tests, and displaced in-scope code.
   - Batch related reads, edits, and checks.
   - Prefer deletion, reuse, and existing capabilities over new abstractions or machinery.
   - Avoid adjacent cleanup, speculative machinery, speculative configurability, and code for hypothetical future requirements.
   - Do not introduce a new abstraction merely to make a small change look architecturally complete.
   - Do not repeat unchanged searches, reads, or commands.
   - Keep repository tracing in explorers; keep edits and implementation decisions in the parent.

   If implementation requires a consequential decision absent from the plan: `REQUIRES REPLANNING`.

3. **Debug**
   - Use `reproduce → hypothesis → evidence → root cause → fix`.
   - Run the smallest discriminating check first.
   - Delegate cross-file diagnosis or large output to the appropriate explorer.
   - Stop diagnosis when root cause is established; apply the smallest supported fix, then verify it.
   - Do not repeat unchanged failures or apply speculative patches. If a claimed repair fails again, record what it disproved and use a discriminating check before another fix.
   - For environment/tooling failures, attempt feasible task-scoped recovery within repository policy; use `BLOCKED` only for a concrete unavailable prerequisite, with attempted remedies.
   - Never create alternate clones/worktrees or replace authoritative generated output to bypass a blocker.

4. **Verify**
   - Review the final diff for unnecessary new code, abstractions, dependencies, configuration, and duplicated existing capability.
   - Prefer focused, quiet checks while iterating.
   - Run required final acceptance/completeness checks once on the final tree.
   - Delegate noisy failure-output analysis and non-local completeness tracing to explorers.
   - Inspect human-authored changed hunks directly; delegate large/generated diff completeness checks when they would add bulk context without improving parent judgment.
   - Run `git diff --check` or equivalent.
   - Repeat a successful check only if later changes could invalidate it.

5. **Commit**
   - If code changed, create one coherent Conventional Commit containing only this plan.
   - Describe the repository change, not workflow state.

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

Keep it factual and compact. For repairs, record each finding ID, fix or rebuttal, and verification evidence; evidence-only progress needs no empty commit. Report status and finish this assigned turn.
