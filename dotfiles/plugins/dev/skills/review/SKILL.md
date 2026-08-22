---
name: review
description: Review an exact code change for approved-plan fidelity and correctness without modifying source. Use when the user invokes $dev:review or asks to review a completed checkpoint, commit range, branch diff, or plan implementation. Do not use to redesign an unimplemented feature.
---

# Review

Determine whether the implementation is correct, complete, and faithful to the approved plan. Review the implemented design rather than substituting a preferred one.

Keep the user in the parent thread and keep source read-only.

## Normalize the inputs

Recover this contract:

1. **Task** — plan-fidelity and correctness review.
2. **References** — approved plan, later approved deviations, repository path, exact diff or commit range, and build results.
3. **Constraints and non-goals** — requested focus, explicit exclusions, and behavior intentionally changed by the plan.

Infer inputs when unambiguous. Confirm the boundary with a cheap status or diff-stat check before delegation. Ask one compact question when the plan or range is ambiguous.

If no approved plan exists, state that fidelity cannot be assessed and ask whether to perform a general correctness review. If the diff mixes unrelated work or is too large for one coherent pass, ask the user to narrow it or approve a chunked review before spending the reviewer turn.

## Choose the reviewer

Review a trivial documentation-only or mechanical diff directly in the parent.

Otherwise spawn one read-only `reviewer` with no history fork and reuse it for follow-up:

- use `gpt-5.6-terra`, `high` for ordinary code review;
- use `gpt-5.6-sol`, `high` when the plan or diff materially involves concurrency, unsafe code, protocol or wire compatibility, security boundaries, distributed state, or performance-critical paths.

Do not run both by default. Pass only the normalized contract and output contract below.

Require inspection of the complete diff, relevant surrounding callers and consumers, affected tests, and validation evidence. Prioritize high-risk paths, then cover the full review boundary. Do not scan unrelated code for completeness theater.

## Evidence standard

Review plan fidelity first and correctness second. Verify acceptance criteria, decisions, invariants, removals or migrations, scope, changed behavior, error paths, and tests.

Report a finding only after tracing the code path and checking that another mechanism does not already handle it. Findings must be concrete, introduced or exposed by the reviewed change, and actionable.

Do not report style preferences, hypothetical future concerns, unrelated pre-existing defects, alternative architectures, duplicate symptoms of one root cause, or behavior intentionally required by the plan. Put unresolved evidence gaps under open questions, not findings.

## Output contract

Return:

1. **Verdict** — `PASS`, `PASS WITH MINOR FINDINGS`, or `CHANGES REQUIRED`.
2. **Findings** — descending severity: `BLOCKER`, `MAJOR`, then `MINOR`; otherwise `None`.
3. **Plan conformance** — only unmet or materially risky criteria, decisions, invariants, removals, or scope boundaries; otherwise `Conformant`.
4. **Verification** — checks inspected or run and material gaps.
5. **Open questions** — only issues repository evidence cannot resolve; otherwise `None`.

Format each finding as `[SEVERITY] path:line — title`, followed by expected behavior, actual code path, concrete impact, evidence, and the smallest correction. Omit repeated fields and do not restate the plan or review process.

If the implementation follows a flawed approved design, separate that concern from implementation findings. If the user disputes a finding, send only that finding and new evidence to the same reviewer and request `UPHELD`, `REVISED`, or `WITHDRAWN`; do not rerun the whole review.
