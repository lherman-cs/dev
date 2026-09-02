---
name: dev-review
description: Independently review one completed plan and revision for contract completeness, correctness, robustness, ownership, simplicity, readability, and evidence. Fix only narrow in-scope issues, then stop.
---

# Dev Review

Review one completed implementation independently as a senior software engineer. Judge the contract, repository, diff, and evidence—not the builder’s reasoning. Do not begin new work or spawn subagents.

`plans/` is Git-ignored local workflow state. Access it directly through the filesystem; never use Git to discover, inspect, validate, stage, or commit its contents.

Use the numbered plan’s `Implementation handoff` and matching `.build.md` file as navigation. Independently verify their claims against the repository, revision, diff, and evidence.

Do not read sibling numbered plans unless the exact plan names one as a dependency and a concrete review question requires it.

## Engineering standard

- Derive truth from the exact plan, its relevant spec sections, the current request, repository instructions, architecture, code, tests, and real or intended callers.
- Treat correctness, data integrity, and explicit security or privacy requirements as mandatory.
- Among otherwise valid implementations, prioritize:
  1. Robustness
  2. Simplicity
  3. Scalability
  4. Performance
  5. Security
- Every abstraction, layer, state, dependency, option, compatibility path, or extension point must satisfy a current requirement or enforce a proven boundary.
- Keep one canonical owner and source of truth.
- Review correctness before simplification.
- Reuse the plan’s repository coordinates and the build evidence to avoid repeating broad discovery, while independently judging every conclusion that affects acceptance.
- Minimize context and tool use. Start from the diff, inspect unchanged code only for concrete questions, batch related searches, and keep diagnostics concise.

## 1. Establish the contract

Resolve:

1. the revision, normally `HEAD`;
2. its exact plan path from the `Dev-Plan:` trailer or an explicit path;
3. the matching build-evidence path by replacing the plan’s `.md` suffix with `.build.md`;
4. the relevant sibling spec sections named by the plan’s `Implementation handoff`;
5. relevant repository instructions and architecture named by the plan.

Do not guess the plan.

Resolve the plan path relative to the repository root and read it directly from `plans/`. If the file is absent, request its exact path or contents.

Read only the spec sections named in the plan’s implementation handoff. Read additional spec sections only when required to answer a concrete contract question raised by the diff or repository evidence.

If the plan predates the `Implementation handoff` section, read the sibling spec once. Do not compensate by reading every sibling plan or broadly surveying the repository.

Read the matching `.build.md` file when present.

Accept build evidence as matching only when:

- its `Plan` is the exact reviewed plan; and
- its `Commit` identifies the reviewed revision, or correctly records a no-change result against that revision.

If the build evidence is absent, incomplete, or stale, continue the review without it and note the limitation only when material. Do not infer missing validation or changed paths.

Use build evidence only to identify:

- paths the builder claims changed;
- commands or evidence the builder claims were verified;
- declared deviations;
- the claimed final revision.

Do not treat the builder’s status or successful command claims as the review verdict.

Inspect version-control state and preserve unrelated production work.

Begin with the complete human-written diff. Inspect generated output only for contract or reproducibility questions. Inspect unchanged surrounding code only when required to evaluate a specific risk.

Use the plan’s named canonical owner, starting points, direct callers, relevant tests, and completeness searches before broadening repository inspection.

If the revision is too broad to review reliably as one acceptance boundary, report a blocker and require it to be split.

## 2. Review in order

### Contract completeness

Confirm every outcome, constraint, and verification requirement is delivered.

Identify partial migrations, missing callers, and claims unsupported by evidence.

Use the plan’s named direct callers, relevant tests, and completeness searches to check the intended boundary without repeating broad repository discovery.

### Correctness and robustness

Inspect relevant:

- success and failure behavior;
- validation boundaries;
- lifecycle and cleanup;
- cancellation and retries;
- idempotency;
- stale, duplicate, or reordered operations;
- concurrency and resource ownership;
- compatibility;
- data integrity;
- security;
- measured scalability or performance requirements.

### Ownership and architecture

Reject:

- responsibility in the wrong owner;
- duplicated policy or state;
- hidden coupling;
- parallel implementations;
- unnecessary public surface;
- violations of authoritative repository constraints.

If the approved plan itself requires avoidable or contradictory architecture, report a blocker and return it to planning.

### Minimum complete design

Challenge every added:

- abstraction;
- wrapper or adapter;
- state value or cache;
- dependency;
- configuration option;
- compatibility path;
- extension point.

Prefer deletion, reuse, derivation, inlining, or moving behavior to its canonical owner.

Do not optimize for fewer characters. Never remove required robustness or clarity.

### Readability and usability

Confirm APIs, names, control flow, errors, comments, and module structure are conventional, locally understandable, and difficult to misuse.

### Evidence quality

Confirm tests and validation:

- apply to the exact reviewed revision;
- would fail if the claimed behavior broke;
- prove the real contract;
- use the real external boundary when required;
- avoid unnecessary fixtures, mocks, sleeps, and implementation coupling.

Use the build evidence to locate prior validation, but independently determine whether that evidence is sufficient and relevant.

## 3. Classify findings

| Severity | Meaning |
|---|---|
| `BLOCKER` | The result cannot be accepted without changing the approved contract, architecture, acceptance boundary, or a fundamental correctness, security, or data-integrity decision. |
| `ISSUE` | A concrete in-scope defect or unnecessary complexity must be fixed before acceptance. |
| `NOTE` | A useful non-blocking observation. It does not require a code change in this review. |

Do not create findings from personal taste, speculative improvements, or unrelated cleanup.

Fix only clear `ISSUE` findings whose correction stays within the approved plan.

Return `BLOCKER` findings to `dev-plan`.

Amend the target only when it is safe and unshared; otherwise follow repository policy or create a separate correction commit.

Preserve the `Dev-Plan:` trailer.

## 4. Verify

When no review fix was required:

- re-check every acceptance item;
- inspect the complete final production diff;
- confirm every remaining mechanism is necessary;
- confirm the build evidence maps to the exact revision and actual contract;
- run focused checks needed to resolve concrete review questions;
- do not automatically rerun a successful expensive command from matching build evidence on an unchanged tree when no finding challenges it;
- rerun an expensive command when its evidence is missing, stale, ambiguous, contradicted, required by repository policy, or necessary to establish the verdict.

After any fixes:

- re-check every acceptance item;
- inspect the complete final production diff;
- confirm every remaining mechanism is necessary;
- run affected focused checks;
- run required final validation once on the final unchanged tree;
- confirm no `BLOCKER` or `ISSUE` remains.

Never accept a result merely because the build evidence reports passing validation.

## 5. Report and stop

Begin with a plain-language summary and one verdict:

- `ACCEPTED`
- `CORRECTED AND ACCEPTED`
- `REQUIRES REPLANNING`

Then report findings as:

| Severity | Location | Finding | Impact | Required action |
|---|---|---|---|---|

Include blockers and issues. Include notes only when they materially help explain the result; notes never block acceptance.

If there are no blockers or issues, state:

`No material findings.`

Follow with:

- **Verified**
- **Commit**
- **Notes**, only when material

Then stop.
