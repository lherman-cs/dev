# Managed workflow protocol v1

This is a wire-format reference, not a replacement for the four role skills.
The Rust host owns dispatch, state, command receipts, and authoritative completion.
An agent returns a proposal/evidence object; it cannot write a successful transition into existence.

## Invocation and lifecycle

`dev a plan <prompt>` keeps the interactive planning conversation. When that session exits,
`dev` independently checks the one new/changed valid package it produced, from the host process.
A session that ends before producing a package is not marked ready. An unchanged package can be
checked explicitly with `dev a project --check <path>` from the user's terminal.
Do not recursively launch Codex from a sandboxed planning shell to simulate this host gate.

`dev a project <path>` owns managed execution. `--check` checks readiness only; `--status`
reads state; `--approve <digest>` is explicit approval of the displayed package snapshot;
`--max-turns <n>` is an optional user budget whose exhaustion PAUSES rather than rejects work.
Planning approval is not an automatic implementation launch. A separate project invocation is required.

Managed sessions use `codex exec --json --output-schema ...`, with exact session-ID resume.
The host disables native agent spawning in those sessions. Do not use spawn_agent, a nested runner,
or another Codex process to bypass its scheduling. Native roles remain available for standalone work.
Read-only reviewer/orchestrator/explorer/maintenance sessions cannot edit production sources.
Approved verification commands run in the host process; review them as executable code before approval.
The host requests command-snapshot authorization before even readiness checks run. For non-interactive
readiness, inspect `--status`, then pass `--check --approve <digest>`. This still never starts implementation.
The separate execution invocation approves production work only after readiness has passed.

## Package

`project.json` must satisfy project.schema.json and semantic validation:

- `version`: 1; `name`: descriptive name; `spec`: exactly `spec.md`.
- `obligations`: stable `{id, text}` binding acceptance obligations.
- `plans`: `{id, file, depends_on, obligations, checks}`.
- Plan ID: a padded numeric prefix and descriptive suffix, e.g. `03-transport`.
- Plan file: exactly `<id>.md`, inside this project directory.
- Every obligation has exactly one owning plan. Split composite obligations where necessary.
- Every plan has executable checks. Dependencies are known IDs and form an acyclic graph.
- `checks`: `{id, argv, cwd, timeout_seconds}`; cwd is repository-relative; no implicit shell.
- `readiness_checks`: baseline/toolchain checks executable BEFORE implementation.
- `final_checks`: required integrated project checks at the final candidate.
- Checks have a 1..86400-second explicit timeout; a failed/timed-out check cannot certify acceptance.

Binding content is spec.md, obligation meanings, and approved command definitions/required check sets.
Plan documents distinguish binding references from adaptable implementation guidance.
Only the declared manifest plans are active; old files retained after approved maintenance are historical.
No project/plan field is a license to push, deploy, send messages, expose credentials, or modify unrelated system state.

## Managed report

Return exactly report.schema.json, with every key present and no extra keys:

| Field | Meaning |
|---|---|
| attempt | Exact host-supplied attempt ID; never reuse an old result's identity. |
| target | Exact host-supplied plan ID, or `@project` for project/readiness/maintenance/final work. |
| revision | Full actual commit ID; only builders may advance it from dispatch. |
| verdict | One of the verdicts below, appropriate to the assigned role/mode. |
| summary | Compact established result, not a confidence claim. |
| coverage | `{id, proof}` for applicable binding obligation IDs. |
| findings | OPEN findings only, with stable IDs and all fields below. |
| resolutions | `{id, disposition, evidence}`; disposition is RESOLVED or REFUTED. |
| responses | Builder `{id, proof}` response for each OPEN finding: fix, verification, or rebuttal. |
| progress | Concrete newly established facts, closed uncertainty, or observed behavior. |
| next_action | The smallest useful next action, empty only when no further work is needed. |
| boundary | `null`, or the concrete boundary object below. |
| proposal | `null`, or a maintenance proposal from the planner. |

Verdicts:

- Builder: COMPLETED, NO_CHANGE, EVIDENCE, BLOCKED, REQUIRES_REPLANNING.
- Explorer: EVIDENCE.
- Maintenance planner: PREPARED, EVIDENCE, BLOCKED, REQUIRES_REPLANNING.
- Reviewer: ACCEPTED, CHANGES_REQUIRED, BLOCKED, REQUIRES_REPLANNING.

COMPLETED means a committed review candidate, not acceptance. NO_CHANGE permits a new check or
rebuttal at the same revision; never create an empty commit to satisfy bookkeeping.
Before handing off, reconcile task-owned partial changes into an explicit candidate. Do not discard
unrelated work. A runtime interruption may retain dirty task-owned work; its saved builder session
must reconcile it before verification or an authoritative handoff.

For READINESS/MAINTENANCE, coverage proves that every obligation has feasible, explicit implementation
and verification coverage. It does NOT claim unimplemented functionality passes.
For INITIAL/FOLLOWUP/ADJUDICATE/FINAL acceptance, coverage concerns implemented behavior at the candidate.

## Findings and closure

Each OPEN finding contains:

`id`, `owner`, `kind`, `requirement`, `evidence`, `impact`, `closure`, `alternative`, `new_evidence`.

- owner: an active numbered plan ID, including for FINAL failures.
- kind: correctness, design, or verification.
- requirement: that owner's exact obligation ID, or `INVARIANT:<name>` / `DESIGN:<name>`.
- A named invariant/design principle still needs evidence from the approved contract or established repository behavior.
- evidence: concrete reachable failure, source proof, reproduction, or demonstrated design deficiency.
- impact: why this blocks an approved outcome or substantially worsens the conforming design.
- closure: the observable state/check needed to close it; not a mandated speculative redesign.
- alternative: required for design findings; identify the materially better conforming approach and actual benefit.
- new_evidence: required for a newly introduced follow-up finding, changed closure, or reassigned owner.
- Use empty strings only for inapplicable alternative/new_evidence fields, not missing substantive evidence.

Every prior OPEN ID must remain OPEN or appear in resolutions with evidence. Do not silently drop findings.
A new material defect must not be concealed for convergence. A settled design must not reopen for preference.
Keep useful compact closure history in follow-up reports; full reports are retained in the host event history.

A boundary object requires `requirement`, `evidence`, `why_no_local_solution`, `attempted_remedies`,
and `decision_needed`. A child's boundary proposal is independently checked before it can stop the project.
Missing tools or services do not automatically imply a defective plan. Failed repairs do not imply either.

## Orchestrator decisions

Return exactly decision.schema.json:

`attempt`, `target`, `action`, `instruction`, `evidence`, `settled_decision`, `replace_worker`.

Actions are BUILD, DIAGNOSE, REVIEW, INVESTIGATE, ADJUDICATE, MAINTAIN, STOP_BLOCKED, STOP_REPLAN.
There is deliberately no ACCEPT, ADVANCE, or COMPLETE action. The host derives those from validated evidence.

The instruction must specify the unresolved question or changed repair approach. Evidence explains why
that action is justified. settled_decision records a materially chosen conforming design, or is empty.
replace_worker resets the builder only for a concrete reason; ADJUDICATE creates an independent evaluator
and makes it the new reviewer. Reviewer disagreements are not resolved by an orchestrator self-approval.

After the same finding survives a claimed repair, BUILD alone is rejected until a diagnostic/investigation
establishes a new fact. Merely changing commit hashes or repeating the same action is not progress.
The host also rejects exact repeated recovery routes with unchanged source tree, findings, and evidence.
Semantic novelty and technical correctness remain the lead/reviewer's responsibility, not a string comparator's.

STOP_BLOCKED/STOP_REPLAN require a corresponding independently validated boundary verdict.
A service outage, unavailable executable, or repeated malformed protocol output pauses the runtime instead.
Transient service failures get bounded backoff/retry of the same saved session, not a fresh engineering loop.
A user turn budget pauses with state intact. Neither is reported as failed plan acceptance.

## Maintenance proposals

A PREPARED proposal contains `rationale`, complete proposed `plans`, and `documents` as `{file, text}` entries.
Do not supply spec.md. The host carries the unchanged binding spec, obligations, and commands forward.
Account for every obligation, preserve every accepted plan/document, and retain executable coverage.
Return a proposal; do not edit the live package. Independent MAINTENANCE review must accept it before promotion.
The host uses a write-ahead intent and recoverable publication to promote the exact checked snapshot.
Changing binding content or approved command definitions requires explicit new planning/readiness/approval.

## Authority and evidence storage

Private authoritative state is in the OS user-data directory under `dev/workflows/<project-key>/`.
A per-worktree advisory lock prevents cooperating runners from writing concurrently.
Attempts retain prompts, exact session IDs, raw events, structured results, and check logs.
Readable `.build.md` / `.review.md` files in plans/ are projections, not writable acceptance certificates.
Legacy accepted handoffs are imported only when plan/build/review/revision match and history is reachable.
They never replace current-revision final integration verification. An imported Base revision may be a repair
baseline, not the original plan baseline; a new reviewer must recover full obligation coverage.
Maintenance retains prior incomplete findings, decisions, and failed approaches in recovery history.

Only a fresh final integration reviewer plus actual passing final receipts, all active plan acceptance,
a clean source tree, and exact unchanged HEAD can produce the host's COMPLETED record.
These gates enforce workflow integrity. They do not prove semantic correctness, defeat a malicious same-user
process, sandbox host verification commands, or intercept standalone Codex/manual Git operations.
