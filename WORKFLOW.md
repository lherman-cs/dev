# Codex workflow

This is the human-facing guide. Workers load their assigned bundled skill and task artifacts, not this guide, the questionnaire, or another framework's router.

## Architecture

```text
Human + Specifier → APPROVED spec
                  → Planner → READY plan
                  → Builder → one fresh Reviewer → accepted task
                                ↓ concrete blocker
                           same task Builder
                                ↓ one repair
                           fresh scoped Reviewer
                                ↓ still blocked
                     change context/capability/plan, not blind retry

All tasks accepted → integrated validation → one fresh final Reviewer
```

Keep exactly five public skills: `dev-spec`, `dev-plan`, `dev-build`, `dev-review`, `dev-project`. Explorer is a read-only factual leaf. `builder_strong` and `reviewer_strong` are capability aliases of the same personas, not extra routine seats. Every new child gets `fork_turns="none"`. One meaningful writer at a time; task gates remain sequential.

One reviewer always owns both requirements and engineering quality. Final review uses that same persona on an integrated assignment. A task Builder may remain warm for that task's questions/repairs only. Review and rereview contexts are fresh; a same-reviewer clarification is not another audit or repair round.

## Authority and quality

The human approves behavior. Specifier owns `spec.md`, Planner owns `plan.md`, controller owns `progress.md`, Builder owns implementation/commits/build reports, and Reviewer owns review reports. Under an existing spec, ordinary private implementation mechanics belong to Builder. A material interface/dependency/strategy defect goes to Planner; product semantics never become a cheap controller ruling.

A bounded explicit human answer may be recorded by the controller in the owning spec clause with an approval note, then affected work resumes without repeating approval. Substantial or unresolved semantic changes reopen affected sections as DRAFT for `dev-spec`. Silence is not approval. Do not let this clerical exception become design authority.

Define done once: behavior, exact interfaces/invariants, non-goals and observable verification. Planner distinguishes binding contracts from implementation guidance. Use exact code only where it resolves consequential uncertainty; do not implement the feature twice in prose and code. Put setup/config/docs with the behavior they enable, and split only at independently testable/reviewable boundaries. Optional global requirements use a small `## Global Constraints` section; packaging carries it verbatim.

Builder runs meaningful RED → GREEN → REFACTOR, prescribed focused checks, and one bounded self-review. Generated/docs/mechanical work gets an explicit meaningful verification exception, not fake RED. Reviewer checks the actual diff and whether evidence proves the required behavior; reported tests do not prove their own adequacy. Rerun only a focused check for a concrete unanswered doubt. Baseline/final checks run at their intended boundary, not in every seat.

Critical/Important means a reachable material failure or explicit unmet requirement attributable to this candidate. Minor/taste/optional hardening never blocks. The reviewer states the failure, impact and observable resolution; a proposed implementation is guidance, not a new requirement. Serious pre-existing unrelated defects are reported as out of scope without silently enlarging this task.

## Controller economics

Keep state, paths, full SHAs, finding IDs, task dependencies, boundaries and concise exceptions in controller context. It can inspect a relevant contract/report to route an exception, but does not independently review or debug. Pass authoritative artifacts unchanged rather than paraphrasing findings. No nested controllers or routine extra reviewers.

Helpers do extraction, Git checks and report validation, not semantic decisions. There is no additional workflow daemon, workflow engine, database or state manifest. The controller still owns the small recovery ledger. Detailed outputs live under `work/`; return tiny status envelopes. Only read the dispatch template relevant now. Use actual runtime completion/wait/resume mechanisms; never poll in chat, guess a tool name, or promise background work after ending a turn.

Explorer is admitted when a bounded factual digest saves a substantial off-topic investigation. Known-path reads and the implementation/review itself stay local. No duplicate parent/Explorer investigations, hidden second opinions, or delegation of judgment. Close completed helpers before consuming more capacity. Thread capacity is not a reason to increase the number of review seats.

## Artifacts and mechanical protocol

```text
plans/<project>/
  spec.md       # approved semantics
  plan.md       # current execution plan
  progress.md   # compact current recovery state; one row per task/finding
  work/         # immutable briefs/diffs, per-candidate reports, repair packets
```

All of `plans/` is Git-ignored. Preparation resolves Git metadata correctly in linked worktrees. Ignore rules never untrack files; explicit workflow-owned index-only cleanup preserves working files and uses a separate cleanup commit. Do not force-add evidence. Commit implementation with explicit paths and Conventional Commits; each repaired candidate is a new commit, never amend a reviewed SHA.

Let `tools` be the absolute directory containing the assigned bundled `dev-project/scripts`. The launcher prints/materializes that content-addressed location; installed assets have the same layout. Run commands directly; do not read helper source or repeatedly request help to rediscover them.

```sh
python3 "$tools/prepare_workspace.py" --repo "$repo"
python3 "$tools/package_task.py" --plan "$project/plan.md" --list
python3 "$tools/package_task.py" --plan "$project/plan.md" --task "$task" \
  --base "$base" --report "$build_report" --output "$brief"
python3 "$tools/validate_workflow.py" candidate-ready --repo "$repo" \
  --base "$base" --candidate "$candidate" --report "$build_report"
python3 "$tools/package_review.py" --repo "$repo" --base "$base" \
  --candidate "$candidate" --brief "$brief" --output "$diff"
```

Task extraction preserves Planner text and appends only bounded metadata/rulings/scope. The original brief is never rewritten after dispatch. A later repair receives its own report path in dispatch, not an appended report with contradictory commit markers. Review packages include all commits in the range, full Git IDs, a diff with context and the brief's SHA-256. External diff/textconv commands are disabled. Helpers print paths/digests, not the payload. Existing outputs cannot be overwritten, including by concurrent exclusive creation.

Build reports remain short Markdown: `Status: COMPLETED`, `Commit: <actual SHA>`, `Verification:` commands/outcomes, implemented behavior and material notes. Builder resolves the commit before `build-handoff`. Metadata validation does not certify test success.

Reviews use the small JSON format in [report-contract.md](dotfiles/.agents/skills/dev-project/prompts/report-contract.md). It binds mode, base, candidate and contract digest, and distinguishes new findings from per-ID resolution evidence. Empty fields cannot stand in for evidence. A `VALID` envelope means the schema/provenance is valid, **not that the task passed**.

```sh
python3 "$tools/validate_workflow.py" reviews --repo "$repo" \
  --base "$base" --candidate "$candidate" --contract "$brief" --mode task \
  --report "$review_report" --repair-output "$repair_packet"
```

A PASS advances only after required validation and the review agree with the current clean tracked candidate. FIXES_REQUIRED creates one packet containing exact blocking findings; Minor bodies and checked evidence stay in the report. BLOCKED is an evidence/authority exception, never acceptance. An invalid report is corrected by its owner without a code repair or another reviewer seat. Do not silently treat a legacy `Verdict: PASS` line as current approval.

## Repair convergence

Initial review covers the assigned candidate completely within scope and returns all material findings found. The controller sends them together to the same task Builder. One submitted repair candidate plus scoped rereview consumes one round; local debugging, questions and report corrections do not.

One ordinary repair is the expectation. After it fails, use the evidence to change the input, resolve a dispute with the originating reviewer, or use the configured stronger capability. No mandatory new diagnosis agent. A single exceptional second reviewed repair requires a recorded concrete reason and changed input/capability. At two reviewed repairs, stop automatic attempts and route the genuine remaining blocker; do not waive it. Preserve counters across splits, restarts, replacements and replans. A capability blocker may escalate earlier without waiting for failure rounds.

```sh
python3 "$tools/package_review.py" --repo "$repo" --base "$fix_base" \
  --candidate "$fixed_candidate" --brief "$brief" --output "$fix_diff"
python3 "$tools/validate_workflow.py" reviews --repo "$repo" \
  --base "$fix_base" --candidate "$fixed_candidate" --contract "$brief" \
  --mode repair --previous "$repair_packet" --report "$rereview_report" \
  --repair-output "$next_repair_packet"
```

A scoped rereviewer explicitly resolves every old blocking ID and inspects repair-caused regressions. Unresolved findings are carried verbatim; retired IDs cannot be reused. Causality is not restricted to changed filenames: a new implementation can break an unchanged caller. A serious defect in the original candidate discovered late is labeled `late-discovery` and remains surfaced/blocking for explicit routing. The helper never downgrades it to make metrics look better. This is bounded review, not an artificial promise that the finding set can only shrink.

A genuine approved contract change gets a successor brief and affected review; old approval cannot apply to its new digest. Preserve counters and explicitly carry every unresolved old finding for the reviewer to resolve/reclassify under the revised authority. Do not fabricate a new digest onto old evidence. Equivalent implementation/command guidance that leaves the binding contract unchanged is a bounded overlay, not a whole replan.

## Recovery and completion

Reconcile spec/plan readiness, compact ledger, actual HEAD/index/worktree, exact report provenance and live agent availability. A missing child is not a reason to redispatch accepted tasks. Dirty fresh starts stop; clearly owned interrupted work is preserved/recovered, ambiguous changes are reported. Cancellation preserves everything. Never reset, stash, clean or route a rejected permission request through another agent.

Read the whole plan once for bounded initial preflight, then its compact index/active task only. Validate the plan-defined baseline once and preserve accepted evidence unless relevant code/contracts changed. Operational splits retain parent requirements, explicit sibling coverage and existing repair counts. They do not grant new architecture or parallel writers.

After all tasks are accepted, obtain whole-project validation and freeze the final contract before dispatching the configured strongest Reviewer:

```sh
python3 "$tools/package_task.py" --final --spec "$project/spec.md" \
  --plan "$project/plan.md" --progress "$project/progress.md" \
  --base "$project_base" --report "$validation_report" --output "$final_contract"
```

Package the full project diff against that contract and validate the review with `--mode final`. The reviewer checks integrated requirements, interactions, deferred concerns and actual code, not all past transcripts. Final blockers get one fresh integrated Builder fix wave, focused checks and full-project validation again, then one fresh `final-repair` review with the original final contract and previous packet. No second automatic final fix wave. Real residual blockers mean incomplete.

On success record final range, evidence, rulings and residual Minors, then delete only `work/`. Retain spec/plan/progress. Workflow completion is a human handoff, not permission to merge/push/rebase or manage worktrees.

## Configuration and installation

Only `dotfiles/.codex/agents/*.toml` owns concrete models/efforts. Skills choose existing role aliases. Defaults are an experimental starting point, not a benchmarked optimum; Low effort does not enforce scope. Review quality and cost-to-accepted-task decide retuning, not token price alone. `python3 tests/validate_assets.py` reports current selections without copying an expected model matrix into tests.

The launcher embeds every role, skill, prompt and helper into a content-addressed runtime directory. Rebuilding the binary installs the new embedded revision; old runtime copies remain available for genuinely old sessions. Starting a fresh `dev a pr` reconciles the current project. Do not edit generated cache files.

`just install-workflow /path/to/worktree` optionally exports only workflow assets. It preserves user config and unrelated files; changed assets and the five retired split-review prompts are backed up before replacement/removal. Old active report formats need a provenance-confirmed reformat/review; never rerun completed work just to migrate a ledger. Preserve existing S/Q finding IDs and counts. An interrupted task already at or beyond the new repair cap must route its blocker, not reset to zero.

## Local validation only

`just test-fast` runs asset validation and Python/Git/filesystem tests. `just test-slow` retains actual Rust unit tests/build and the compiled-launcher recording-shim test. `just test` runs both; `just check` remains an alias. No CI workflow, remote runner, or automatic paid model eval is added. See [EVALS.md](EVALS.md) for what deterministic tests can and cannot establish and [VALIDATION.md](VALIDATION.md) for results actually obtained.
