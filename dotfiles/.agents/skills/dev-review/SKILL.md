---
name: dev-review
description: Independently review one completed numbered plan and revision for completeness, correctness, ownership, simplicity, and evidence. Never modify production code.
---

# Dev Review

Review exactly one completed numbered plan against one revision. Never modify production code.

Judge the plan, repository, diff, and evidence—not the builder's reasoning.

Require one exact plan path. Review `HEAD` unless another revision is supplied. `plans/` is Git-ignored workflow state.

## Main-thread boundary

Preserve the parent for understanding the contract, inspecting material changed code, reasoning about correctness, classifying findings, and deciding the verdict. Keep surrounding repository discovery out of its context.

The parent may directly consume only:
- the exact numbered plan and matching build evidence;
- applicable repository instructions;
- compact explorer findings;
- material human-authored changed hunks;
- exact surrounding source needed to validate a finding;
- focused verification results.

Do not load broad caller graphs, unchanged modules, generated diffs, large diagnostics, or repository history into the parent.

After reading the contract and changed-file inventory, spawn `explorer` before surrounding-repository investigation.

## Explorer

Use `explorer` as the primary repository context owner for review evidence.

Spawn with `agent_type="explorer"` and `fork_turns="none"`.

Prefer one primary explorer for related review questions and continue with it for follow-ups. Spawn another only for an independent investigation without substantial overlap.

Give it the plan path, reviewed revision, and changed paths. Ask it to establish:
- canonical ownership and surrounding architecture;
- callers, consumers, migrations, and displaced paths;
- lifecycle, cleanup, failure, ordering, concurrency, validation, and security relationships relevant to the change;
- relevant tests and fixtures;
- unchanged code whose behavior can invalidate the patch;
- completeness risks and large/generated diff facts.

Require concise factual conclusions with `path::symbol` evidence and material uncertainty.

Do not ask it to "review the patch", find bugs generally, classify severity, propose fixes, or decide the verdict. The explorer gathers facts; the parent judges.

Do not duplicate explorer discovery in the parent. Inspect only changed hunks and exact cited source needed to reason about a material concern.

If `explorer` is unavailable, use only narrow direct reads required to continue. Broad parent-side discovery is not an allowed fallback.

## Workflow

1. **Establish**
   * Read the exact plan and matching `.build.md` once.
   * Inspect version-control state and the changed-file inventory.
   * Spawn the primary explorer for surrounding repository evidence.
   * Inspect material human-authored diff hunks directly; avoid dumping large generated or mechanical diffs into the parent.
   * Do not reread `spec.md`, sibling plans, or broadly rediscover the repository.

   Build evidence records claimed work and verification; it is never the verdict.

   If repository reality invalidates the approved plan: `REQUIRES REPLANNING`.

2. **Review**
   Check only what can affect the plan's contract:
   * scope and acceptance are complete;
   * required callers and migrations are handled;
   * relevant success, failure, validation, lifecycle, cleanup, ordering, concurrency, compatibility, integrity, security, and performance behavior is correct;
   * responsibility remains in the canonical owner;
   * no duplicated policy/state or unnecessary abstraction, dependency, configuration, compatibility, or public surface was added;
   * verification applies to the reviewed revision and proves the contract.

   Keep reasoning about changed code in the parent. Turn surrounding-repository questions into concrete follow-ups for the primary explorer. Stop when each concern is proved or disproved.

3. **Classify**
   * `BLOCKER` — requires changing the contract, architecture, acceptance boundary, or a fundamental correctness/security/integrity decision.
   * `ISSUE` — concrete in-scope defect or unnecessary mechanism that must be corrected.

   Do not report taste, speculative improvements, or unrelated cleanup.

4. **Verify**
   * Run only checks needed to establish the verdict.
   * Do not rerun expensive successful build checks without a concrete reason.
   * Delegate large-output inspection and non-local failure tracing to `explorer`.
   * Never accept solely because build evidence reports success.

5. **Handoff**

Write `plans/<project>/<NN>-<outcome>.review.md`.

Accepted:

```markdown
# Review
Plan: <path>
Revision: <revision>
Verdict: ACCEPTED
```

Otherwise:

```markdown
# Review
Plan: <path>
Revision: <revision>
Verdict: CHANGES REQUIRED | REQUIRES REPLANNING

## Findings
| ID | Severity | Location | Finding | Required outcome |
|---|---|---|---|---|
| R1 | ISSUE | `<path>::<symbol>` | <defect> | <required state> |
```

State what is wrong and the required outcome, not how to implement the fix.

Report the verdict and material findings. Then stop.
