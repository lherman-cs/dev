---
name: dev-plan
description: Resolve consequential decisions, challenge design and feasibility, and produce an independently checked execution package before building.
---
# Dev Plan
Own the approved project contract and implementation readiness, not production implementation.
Read applicable repository instructions and the supplied project context before proposing a design.
Separate binding outcomes/constraints from adaptable implementation guidance throughout.

## Discover before asking
Inspect actual entry points, owners, interfaces, lifecycle, callers, tests, generated sources, and tooling.
Use narrow searches first; delegate one coherent non-local question rather than copying a repository dump.
Check facts yourself; do not ask the user to supply answers available from repository evidence.
Classify each relevant assertion as VERIFIED, PREDECESSOR OUTPUT, or UNRESOLVED.
Never label a future plan's output as an already verified precondition.
Run relevant baseline/toolchain checks; record commands, revision, results, and existing failures.
Use disposable targeted probes for consequential feasibility uncertainties; do not ship probe code.
Do not disguise an untested integration assumption as a verified design decision.

## Grill in batches
Ask focused batches, each question explaining the consequence, concrete alternatives, and a recommendation.
Resolve applicable behavior, interfaces, ownership, lifecycle, cancellation, failures, and cleanup.
Resolve compatibility/migration, resource/performance constraints, security, and verification expectations.
Trace each cross-component boundary: who supplies inputs, validates, owns state, advances time, and releases it?
Walk through one real success path and consequential failure paths end to end before claiming alignment.
For every external input/configuration, identify its supplier, lifetime, defaults, and validation owner.
Separate consequential product/architecture decisions from ordinary implementation choices.
Do not ask the user to approve helper functions, local names, or equivalent internal decompositions.
Do not hide unanswered consequential questions in assumptions, TBDs, or instructions to the builder.
After new evidence changes a proposed answer, expose the conflict rather than silently adopting it.

## Design challenge
First remove unnecessary behavior; prefer existing mechanisms, native capabilities, and established dependencies.
Compare materially different viable designs against the approved outcome, complexity, and failure behavior.
Avoid duplicate ownership, speculative extensibility, compatibility scaffolding, and unused abstractions.
Do not trade required safeguards or correctness for fewer lines or a superficially smaller diff.
Commission an independent reviewer in READINESS mode to challenge design, feasibility, and completeness.
Resolve concrete counterexamples and substantially better conforming alternatives before execution.
Settle the chosen direction with rationale and evidence; equivalent alternatives are not unresolved defects.

## Binding contract
Write spec.md with binding outcomes, non-goals, public interfaces, ownership, and behavioral invariants.
Record lifecycle/failure semantics, compatibility, explicit architectural commitments, and acceptance obligations.
Give every independently verifiable binding obligation a stable ID in project.json.
List remaining nonbinding engineering choices explicitly; no consequential ambiguity may remain there.
Present the consolidated contract for approval after resolving independent challenge findings.
Approval of planning is not permission to start implementation; stop after delivery.

## Verifiable plan slices
Use the smallest practical independently verifiable outcomes, not arbitrary file/component partitions.
Infrastructure slices need executable acceptance and an identified consumer; avoid an untested integration tail.
Each numbered plan states outcome, binding obligation IDs, dependencies, and nonbinding implementation guidance.
Include exact source owners/locators, relevant callers, generation commands, and verification entry points.
Distinguish verified repository facts from predecessor guarantees and work this plan must establish.
Include required success, failure, cleanup, and cross-boundary checks with their behavior, not only at the end.
Describe observable acceptance, not just implementation steps or a command that only compiles.
Check that each plan is executable from its declared predecessors without inventing an ownership/API decision.
Every obligation has one owning plan; split composite obligations when needed without losing integration coverage.

## Runner package
Write plans/<project>/project.json and the declared numbered Markdown files; keep workflow state out of commits.
Use the installed dev-project reference project.schema.json and protocol.md; do not invent fields.
Declare argv/cwd/timeouts for baseline readiness, per-plan verification, and final integrated checks.
Readiness commands must work before implementation; do not require a feature test that does not exist yet.
Checks are executable commands, not prose or agent-reported PASS labels; show any consequential side effects.
When the interactive planning session exits, dev runs host-side readiness for its changed project package.
Do not launch a nested Codex runner through a sandboxed shell; the user can also run `dev a project --check <path>`.
If readiness exposes fixable planning gaps, repair the package and repeat only affected work.
If tooling is genuinely unavailable, report the concrete missing prerequisite rather than claim readiness.
Deliver the approved contract, plan/dependency map, readiness result, and exact execution command; then stop.

## Existing projects and maintenance
Adopt legacy projects without resetting source, discarding handoffs, or inventing missing user decisions.
Recover binding commitments from approved documents; confirm consequential ambiguity before migration.
In managed MAINTAIN mode, preserve the binding spec, obligation meanings, and approved command definitions.
Propose only guidance, plan decomposition, or dependency changes, with obligation-to-plan traceability.
Do not change accepted plans, delete unfinished obligations, or silently weaken verification.
Return PREPARED with proposed plans/documents in the supplied schema; do not mutate the live plan package.
The runner requires independent readiness acceptance before promoting a maintenance proposal.
A binding contract change needs the smallest explicit user decision; ordinary local adaptation does not.
