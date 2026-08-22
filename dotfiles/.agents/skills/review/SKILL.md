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

## Model and delegation contract

Review a trivial documentation-only or mechanical diff directly in the parent.

The parent coordinator is `gpt-5.6-luna`. For every non-trivial code review, make one native delegation to the configured `reviewer` agent, which must use `gpt-5.6-sol` with `high` reasoning. Sol is required for ordinary and high-risk reviews; do not select Terra or Luna for the reviewer role.

Reuse the same reviewer handle for follow-up. Do not fork the full conversation history. Pass only the normalized contract, repository path, exact review boundary, and output contract below. Do not start parallel reviewers or background retry processes.

If native reviewer delegation is unavailable, do not launch nested `codex exec`, request network escalation, use `--approve-for-me`, or transmit repository contents to another process automatically. Those actions do not preserve the reviewer handle and may cross the user's authorization boundary. For a user request that permits general correctness review, complete the review locally in Luna and state `Sol reviewer unavailable` under Verification and Open questions. Otherwise stop with `DELEGATION UNAVAILABLE`. Never present the local result as an independent Sol review.

If a delegation attempt starts but fails, wait for or terminate that attempt before falling back. Do not leave background agents running and do not retry the unchanged failed command more than once.

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
