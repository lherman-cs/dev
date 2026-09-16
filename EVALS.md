# Local workflow evaluation

## Default, deterministic, no model calls

```sh
python3 -m pip install -r tests/requirements.txt
just test-fast
just test-slow
# Both, or the existing alias:
just test
just check
```

`test-fast` validates role/skill/prompt/helper wiring and runs actual Python/Git/filesystem regression tests. It covers exact range/contract handoffs, malformed reports, stale approvals, complete finding resolution, unchanged-caller regression provenance, serious late discoveries, immutable files, ignored artifacts, linked worktrees and safe installer migration. It does not decide whether a reviewer is technically correct.

`test-slow` runs Cargo unit tests, builds the launcher and runs its existing recording Codex shim. This exercises the compiled argv/config/materialization path without invoking a model. Locked Cargo dependencies may need to be fetched once on a cold cache. No CI workflow is supplied.

## Behavioral pressure scenarios

`tests/workflow_pressure_cases.yaml` is an explicit manual/live scenario catalog. Asset validation checks its schema and coverage, not whether an LLM obeys it. Do not report the catalog as passed live evaluations.

For a local behavioral trial, use a disposable fixture repository, explicit authorization for paid Codex use, the exact role configuration and a known starting candidate. Record task outcome, missed planted defects, unsupported blockers, repair rounds, repeated discoveries, tool turns, raw/cached input and output/reasoning usage, and time to correctly accepted task. Do not run such trials automatically from `just test`.

Compare one role/config change at a time on representative mechanical, multi-file and systems tasks. Keep a quality guard: a lower cost or higher first-pass acceptance that misses real defects is a regression. Track serious late discoveries and stale-evidence mistakes separately from legitimate repair regressions. Keep model-availability/permission failures separate from reasoning failures.

Neither static phrase checks nor passing helpers prove live orchestration, review calibration, or an optimal model/effort choice. VALIDATION.md records only commands actually run.
