---
name: dev-review
description: Independently review one completed plan and revision for contract completeness, correctness, robustness, ownership, simplicity, readability, and evidence. Fix only narrow in-scope issues, then stop.
---

# Dev Review

Review one completed implementation independently as a senior software engineer. Judge the contract, repository, diff, and evidence—not the builder's reasoning. Do not begin new work or spawn subagents.

## Standards

- Derive truth from the exact plan, its spec, the current request, repository instructions, architecture, code, tests, and real or intended callers.
- Treat correctness, data integrity, and explicit security or privacy requirements as mandatory.
- Among compliant implementations, prefer: **Robustness → Simplicity → Scalability → Performance → Security**.
- Require every abstraction, layer, state, dependency, option, compatibility path, or extension point to satisfy a current requirement or enforce a proven boundary.
- Keep one canonical owner and source of truth.
- Review correctness before simplification.
- Minimize context and tool use: start from the diff, inspect unchanged code only for concrete questions, batch related searches, and keep diagnostics concise.

## 1. Establish the contract

Resolve:

1. the revision, normally `HEAD`;
2. its exact plan from the `Dev-Plan:` trailer or an explicit path;
3. the sibling spec;
4. relevant repository instructions and architecture.

Do not guess the plan. Inspect version-control state and preserve unrelated work.

Begin with the complete human-written diff. Inspect generated output only for contract or reproducibility questions. Inspect unchanged surrounding code only when required to evaluate a specific risk. If the revision is too broad to review reliably as one acceptance boundary, report a blocker and require it to be split.

## 2. Review in order

### Contract completeness

Confirm every outcome, constraint, and verification requirement is delivered. Identify partial migrations, missing callers, and claims unsupported by evidence.

### Correctness and robustness

Inspect relevant success and failure behavior, validation boundaries, lifecycle and cleanup, cancellation, retries, idempotency, stale or reordered operations, concurrency, resource ownership, compatibility, data integrity, security, and measured scalability or performance requirements.

### Ownership and architecture

Reject responsibility in the wrong owner, duplicated policy or state, hidden coupling, parallel implementations, unnecessary public surface, and violations of authoritative repository constraints. If the approved plan itself requires avoidable or contradictory architecture, report a blocker and return it to planning.

### Minimum complete design

Challenge every added abstraction, wrapper, adapter, state value, cache, dependency, option, compatibility path, and extension point. Prefer deletion, reuse, derivation, inlining, or moving behavior to its canonical owner.

Do not optimize for fewer characters. Never remove required robustness or clarity.

### Readability and usability

Confirm APIs, names, control flow, errors, comments, and module structure are conventional, locally understandable, and difficult to misuse.

### Evidence quality

Confirm tests and validation would fail if the claimed behavior broke, prove the real contract, use the real external boundary when required, and avoid unnecessary fixtures, mocks, sleeps, and implementation coupling.

## 3. Classify findings

| Severity | Meaning |
|---|---|
| `BLOCKER` | The result cannot be accepted without changing the approved contract, architecture, acceptance boundary, or a fundamental correctness, security, or data-integrity decision. |
| `ISSUE` | A concrete in-scope defect or unnecessary complexity must be fixed before acceptance. |
| `NOTE` | A useful non-blocking observation. It does not require a code change in this review. |

Do not create findings from personal taste, speculative improvements, or unrelated cleanup.

Fix only clear `ISSUE` findings whose correction stays within the approved plan. Return `BLOCKER` findings to `dev-plan`. Amend the target only when it is safe and unshared; otherwise follow repository policy or create a separate correction commit. Preserve the `Dev-Plan:` trailer.

## 4. Verify

After any fixes:

- re-check every acceptance item;
- inspect the complete final diff;
- confirm every remaining mechanism is necessary;
- run focused checks and required final validation once;
- confirm no `BLOCKER` or `ISSUE` remains.

## 5. Report and stop

Begin with a plain-language summary and one verdict:

- `ACCEPTED`
- `CORRECTED AND ACCEPTED`
- `REQUIRES REPLANNING`

Then report findings as:

| Severity | Location | Finding | Impact | Required action |
|---|---|---|---|---|

Include blockers and issues. Include notes only when they materially help the user understand the change; notes never block acceptance. If there are no blockers or issues, state `No material findings.`

Follow with:

- **Verified**
- **Commit**
- **Notes**, only when material

Then stop.
