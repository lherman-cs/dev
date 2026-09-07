---
name: dev-review
description: Independently review one completed numbered plan and revision for completeness, correctness, ownership, simplicity, and evidence. Never modify production code.
---

# Dev Review

Review exactly one completed numbered plan against one revision. Never modify production code.

Judge the plan, repository, diff, and evidence—not the builder's reasoning.

Require one exact plan path. Review `HEAD` unless another revision is supplied. `plans/` is Git-ignored workflow state.

## Explorer

Delegate repository investigation to `explorer` whenever resolving a concrete review concern requires more than one search or source read.

Do not use `explorer` for facts already directly established by the plan, scoped diff, or one known file or symbol.

Always spawn with `agent_type="explorer"` and `fork_turns="none"`.

Give it:
- one self-contained review question;
- the narrowest known scope;
- relevant plan anchors, changed paths, symbols, callers, tests, or suspected behavior;
- the exact correctness, completeness, ownership, lifecycle, or simplicity concern being investigated.

Do not perform the same repository investigation in the parent thread.

The parent may directly:
- inspect the complete scoped diff;
- read one known file, symbol, caller, or test;
- inspect specific code identified by the explorer;
- perform targeted verification needed to judge a finding.

If a review concern expands into multiple searches or source reads, delegate it rather than broadly rediscovering the repository in the parent.

Reuse the explorer for related follow-ups; do not repeat its searches.

Explorer gathers repository facts. You independently judge them.

## Workflow

1. **Establish**

   * Read the exact plan and matching `.build.md` when present.
   * Inspect the complete human-written diff.
   * Read additional code directly only for a single concrete and narrowly located review question.
   * Delegate broader or multi-step repository investigation to `explorer`.
   * Start from the plan's verified preconditions and repository handoff.
   * Do not reread `spec.md`, sibling plans, or broadly rediscover the repository.
   * Do not duplicate explorer investigation in the parent.

   Build evidence records claimed work and verification; it is never the verdict.

   If repository reality invalidates the approved plan: `REQUIRES REPLANNING`.

2. **Review**

   Check:

   * scope and acceptance are complete;
   * required callers/migrations are handled;
   * relevant success, failure, validation, lifecycle, cleanup, ordering, concurrency, compatibility, integrity, security, and performance behavior is correct;
   * responsibility remains in the canonical owner;
   * no duplicated policy/state or unnecessary abstraction, dependency, configuration, compatibility, or public surface was added;
   * verification applies to the reviewed revision and proves the contract.

   When establishing any of these requires multi-file or multi-search investigation, delegate the concrete question to `explorer`.

3. **Classify**

   * `BLOCKER` — requires changing the contract, architecture, acceptance boundary, or a fundamental correctness/security/integrity decision.
   * `ISSUE` — concrete in-scope defect or unnecessary mechanism that must be corrected.

   Do not report taste, speculative improvements, or unrelated cleanup.

4. **Verify**

   * Run only checks needed to establish the verdict.
   * Do not rerun expensive successful build checks without a concrete reason.
   * Never accept solely because build evidence reports success.
   * Delegate repository investigation needed to validate a suspected finding when it requires multiple searches or source reads.

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
