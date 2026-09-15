# Builder dispatch: task candidate

Use `dev-build`.

Repository/worktree: {{repo}}
Project: {{project}}
Task brief: {{brief_path}}
Base commit: {{base_sha}}
Write build report: {{build_report_path}}

Implement only the immutable task brief. Follow RED -> GREEN -> REFACTOR unless the brief permits a concrete TDD exception. Run only the brief-prescribed validation plus checks necessary to establish the candidate. Self-review, make one local task commit, finalize the compact build report with its actual SHA, and run the dev-build handoff validator before returning the candidate SHA.

Own implementation and debugging within the task. Ask the controller one specific question only for missing context or a needed ruling; supply a proposed correction and evidence when possible. A routine command correction needs a ruling, not a Planner. Surface actual task-size, dependency/interface/strategy, or semantic blockers instead of silently expanding/replanning.
Read the brief before its named owning code/tests; no routine full spec/plan/history load. Implement the specified integration and proof cases, preserving their observable assertions; resolve ordinary mechanics locally. Ask only about a consequential missing/contradictory decision, not for approval to begin. If the brief has an operational unit scope, implement that unit and retain its shared interface obligations. For size-only pressure return `NEEDS_SPLIT` with a viable first unit, not `REPLAN_REQUIRED`. Resume when the controller supplies context/scope. Return status, report path, and SHA rather than repeating the report.
