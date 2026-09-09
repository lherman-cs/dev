# Native workflow handoffs

These are conventions for existing Markdown plans and evidence, not a replacement scheduler.
The technical lead still chooses engineering actions; Codex still owns native agent execution.
Use the installed `dev a` launcher. Its synchronous lifecycle hooks inject assignment identity,
validate child handoffs before completion, and check root completion. Never invoke the hidden hook
command or edit `.workflow.json` to manufacture a receipt.

## Project documents

Keep `spec.md` binding, and label adaptable directions as Implementation guidance in numbered plans.
List stable project obligations under spec's `## Acceptance` as `- [O1] <required outcome>`.
Assign every obligation to exactly one numbered plan using the same ID under its `## Acceptance`.
Several IDs may belong to one plan; other prose, local checks, and supporting constraints remain allowed.
Copy enough binding context into each plan that its builder does not need sibling plans or `spec.md`.
Record `## Dependencies` as `None`, or one `- `plans/project/01-name.md` — consumed output` line per dependency.
Use exact project-relative paths from the repository root, not bare filenames or paths to another worktree.
List approved integration commands under spec's `## Final checks`, one `- `command`` per line.
Commands may call existing test scripts; the reviewer runs them in the designated worktree and records results.
The hook does not execute these commands or move verification outside the normal Codex permissions.

## Native assignments

Start fresh workers with the required native role and no inherited conversation; reuse only within one plan.
Supply task names with lowercase letters, digits, and underscores when the tool requires them.
For V2, use `followup_task` to start an idle worker's next turn, not `send_message`.
For V1, use `send_input` with `message`, not the alternative `items` encoding.
Read the installed tool schema rather than inventing extra arguments or aliases.

Put these headers before any `##` headings in each dispatch message:

```text
Plan: plans/example/01-outcome.md
Mode: BUILD

Use $dev-build. Complete this plan and its supplied OPEN findings.
```

A code-review message uses Mode INITIAL, REPAIR, ADJUDICATE, or FINAL and includes
`Revision: <full current HEAD>`. Project-level modes use `Plan: plans/example` instead.
READINESS reviews the written package before explicit execution approval.
MAINTAIN commissions a planner to propose a conforming plan update; MAINTENANCE reviews the proposal.
ADJUDICATE receives an exact plan or project and a specific dispute/boundary question.
FINAL receives the project and must use a reviewer independent of the plan workers.
An adjudicator can inspect unfinished work for a boundary claim, but cannot accept dirty/unverified implementation.

The hook appends Attempt, Snapshot, Original base, Assignment base, and Handoff.
Copy the supplied values, not remembered hashes. Use the original base for full plan change coverage;
use Assignment base for this build attempt's `Base revision`. A repair may leave HEAD unchanged.
The Handoff path is authoritative for this assignment; retain earlier findings before replacing it.
Each assignment, even at the same revision, has a different Attempt ID. A malformed handoff is corrected
by the same running worker under that ID; it does not require rebuilding completed work.

## Evidence identity

Keep the existing build fields and sections. Add this identity prefix to the handoff:

```text
# Build
Plan: plans/example/01-outcome.md
Mode: BUILD
Attempt: <injected ID>
Snapshot: <injected SHA-256>
Base revision: <assignment base>
Commit: <full resulting commit, or none for NO CHANGE>
Status: COMPLETED | NO CHANGE | BLOCKED | REQUIRES REPLANNING
```

Reviews use the same Plan, Mode, Attempt, and Snapshot fields, with `Revision` and `Verdict`.
Readiness and maintenance snapshots identify all written plans plus the binding spec, not a Git commit
containing ignored `plans/` files. Their source baseline is also checked before acceptance.
Project-level review artifacts are deliberately separate:
`readiness.review.md`, `maintenance.review.md`, `project.review.md`, and `boundary.review.md`.
MAINTAIN writes `maintenance.build.md`; per-plan work keeps `<stem>.build.md` and `<stem>.review.md`.

## Review findings and closure

Use `## Acceptance` for applicable obligation IDs and their evidence; `## Verification` for commands and results.
A review cannot ACCEPT without coverage and verification. Evidence adequacy remains the independent reviewer's job.
OPEN findings belong in a `## Blocking findings` table with these columns:

```text
| ID | Kind | Requirement | Evidence | Impact | Required outcome |
|---|---|---|---|---|---|
| 01-R1 | CORRECTNESS | O1 | file::symbol / reproduction | actual failure | observable passing check |
```

Kind is CORRECTNESS or DESIGN. Design findings explicitly establish an alternative, material benefit,
and replacement cost; they are not limited to defects, but equally good style preferences do not block.
Use plan-qualified IDs to avoid collisions if plans are later merged. Never renumber a carried finding.
Add `New evidence` when reopening design after initial review. FINAL findings also require exact `Owner` plan paths.
For every previously OPEN finding, either retain it or add a `## Resolutions` table with ID, State, Evidence.
State is RESOLVED or REFUTED; counterevidence can legitimately refute a reviewer finding.
Record settled directions and their rationale under `## Decisions`; copy only compact relevant history on replacement.
A CODE REVIEW verdict is ACCEPTED, CHANGES REQUIRED, BLOCKED, or REQUIRES REPLANNING.
ACCEPTED requires zero OPEN findings; CHANGES REQUIRED requires at least one.
BLOCKED and REQUIRES REPLANNING may retain OPEN findings; neither closes them nor accepts work.
Retain, resolve, or refute every previously OPEN ID regardless of the verdict.
Technical boundary claims need `## Reason` with evidence and attempted remedies, plus `## Next action`.
They require an independent ADJUDICATE review before the orchestrator reports a terminal technical stop.
A reviewer cannot adjudicate its own finding; reuse a dedicated adjudicator only for that adjudication's follow-ups.

FINAL acceptance needs a `## Verification` table with Check, Revision, Result, Evidence for each command in
spec's Final checks. Check is the exact command text without backticks, Result is PASS, and Revision is current HEAD.
A PASS row is not proof by itself: actually run/inspect the check, disclose limits, and never relabel old results.
Final acceptance is rejected if the source tree is dirty, the revision changes, or any owning plan remains incomplete.

## Plan maintenance

Leave live plans untouched while a planner writes `.proposal/spec.md`, proposed numbered plans, and
`.proposal/maintenance.md`. Copy the binding spec and accepted numbered plans byte-for-byte.
The mapping file explains the change and includes these tables:

```text
## Obligation mapping
| ID | Owner | Evidence |
|---|---|---|
| O1 | plans/example/01-outcome.md | preserved required outcome and executable check |

## Finding mapping
| Old plan | ID | Owner | Evidence |
|---|---|---|---|
| plans/example/01-outcome.md | 01-R1 | plans/example/02-new-owner.md | original review path and closure condition |
```

Map every obligation once and every OPEN finding once; omit Finding mapping only when no findings remain.
The independent MAINTENANCE reviewer checks the exact proposed documents and the exact mapping file.
Only then replace live numbered plans with the reviewed set and remove superseded unfinished numbered documents.
Keep original review evidence and all settled decisions/failed approaches; the journal carries pending IDs to new owners.
Changing the reviewed proposal or mapping requires review again. Binding changes require user approval and new READINESS,
not a maintenance exception. Source implementation does not belong in plan maintenance.

## Recovery and completion

`.workflow.json` stores hook-observed workers, attempts, baselines, package approvals, and artifact hashes.
It is mechanical state, not a second plan manifest or an assertion that tests are adequate.
`project.progress.md` stores compact engineering context: decisions, failed approaches, OPEN IDs, and next action.
Resume the same coordinator with `dev a resume` after interruption; its model/profile selection remains native.
Never duplicate an active attempt. Observe successful native interruption/closure before replacing a worker.
Correct missing handoff fields in the same attempt; do not turn metadata errors into another implementation round.

A normal planner ends with `Status: READY`; exact-snapshot independent readiness must already exist.
Execution starts separately with `dev a project plans/example`; that invocation approves the reviewed snapshot.
The orchestrator ends with `Status: COMPLETED` only after final acceptance, or independently evidenced BLOCKED/
REQUIRES REPLANNING. A real runtime/user-resource interruption uses `Status: PAUSED`, `Reason`, and `Next action`.
Do not classify repeated repair rounds as PAUSED, BLOCKED, or REQUIRES REPLANNING; change the recovery strategy.

Hooks require trust in Codex `/hooks`; the launcher does not bypass trust or change sandbox/approval settings.
Disabled/untrusted hooks, specialized unhooked tool paths, direct source/state edits, and dishonest evidence are outside
this integrity boundary. The explicit project launcher also rejects an exit with no observed validated stop.
No natural-language policy, hook, or field validator guarantees eventual completion or software correctness.
