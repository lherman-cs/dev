---
name: dev-review
description: Independently review one completed numbered plan and revision for completeness, correctness, ownership, simplicity, and evidence. Never modify production code
---

# Dev Review

Review exactly one completed numbered plan against one revision. Never modify production code.

Judge the plan, repository, diff, and evidence—not the builder's reasoning.

Require one exact plan path. Review `HEAD` unless another revision is supplied. `plans/` is Git-ignored workflow state.

## Context discipline

Preserve the parent thread for understanding the contract, inspecting the actual change, reasoning about correctness, classifying findings, and deciding the verdict.

Repository search, surrounding-code discovery, caller tracing, lifecycle tracing, test discovery, and large-output inspection are supporting work. Offload them to `explorer`.

The parent should directly consume only:

* the exact numbered plan;
* matching build evidence when present;
* applicable repository instructions;
* the human-written scoped diff;
* concise explorer findings;
* specific surrounding source locations needed to validate a finding;
* focused verification results.

The diff is the primary review artifact and belongs in the parent. The surrounding repository does not.

## Explorer

Use `explorer` for repository evidence needed to review the change, including:

* ownership and architectural context;
* callers and consumers;
* migrations and displaced paths;
* lifecycle, cleanup, failure, ordering, and concurrency relationships;
* validation and security boundaries;
* relevant tests and fixtures;
* unchanged code whose behavior affects a changed path;
* completeness checks;
* large verification or diagnostic output.

Spawn with `agent_type="explorer"` and `fork_turns="none"`.

Prefer one primary explorer for related review questions. Let repository context accumulate there and continue with it when follow-up questions depend on that context.

Spawn another explorer only for an independent investigation that can proceed without duplicating the same repository evidence.

Give the explorer:

* one concrete factual review question;
* relevant changed paths, symbols, plan anchors, or suspected behavior;
* the exact uncertainty the parent needs resolved.

Require a compact result containing:

* the direct factual answer;
* relevant `path::symbol` evidence;
* important relationships;
* material uncertainty or conflicting evidence.

Do not ask the explorer to review the patch generally, find bugs without a concrete question, classify severity, propose fixes, or decide the verdict.

The explorer gathers facts. The parent reviews and judges.

Do not duplicate explorer discovery in the parent. Inspect only the exact cited source needed to validate a material finding or resolve conflicting evidence.

If `explorer` is unavailable, use only narrowly targeted direct reads needed to continue. Broad parent-side repository discovery is not an allowed fallback.

## Workflow

1. **Establish**

   * Read the exact plan and matching `.build.md` when present.
   * Inspect the complete human-written scoped diff once.
   * Start from verified preconditions and the repository handoff.
   * Delegate surrounding repository context to `explorer`.
   * Do not reread `spec.md`, sibling plans, or broadly rediscover the repository.
   * Revisit diff locations only for a concrete review question.

   Build evidence records claimed work and verification; it is never the verdict.

   If repository reality invalidates the approved plan: `REQUIRES REPLANNING`.

2. **Review**

   Check what can affect the plan's contract:

   * scope and acceptance are complete;
   * required callers and migrations are handled;
   * relevant success, failure, validation, lifecycle, cleanup, ordering, concurrency, compatibility, integrity, security, and performance behavior is correct;
   * responsibility remains in the canonical owner;
   * no duplicated policy/state or unnecessary abstraction, dependency, configuration, compatibility, or public surface was added;
   * verification applies to the reviewed revision and proves the contract.

   Keep reasoning about changed code in the parent.

   Turn questions about the surrounding repository into concrete explorer requests rather than tracing them directly in the parent. Continue with the same explorer for related follow-ups.

   Stop investigating a concern when it is proved or disproved.

3. **Classify**

   * `BLOCKER` — requires changing the contract, architecture, acceptance boundary, or a fundamental correctness/security/integrity decision.
   * `ISSUE` — concrete in-scope defect or unnecessary mechanism that must be corrected.

   Do not report taste, speculative improvements, or unrelated cleanup.

4. **Verify**

   * Run only checks needed to establish the verdict.
   * Do not rerun expensive successful build checks without a concrete reason.
   * Delegate large-output inspection or non-local failure tracing to `explorer`.
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
