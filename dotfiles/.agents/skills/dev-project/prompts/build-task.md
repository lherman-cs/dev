# Builder dispatch: task candidate

Use `dev-build`.

Repository/worktree: {{repo}}
Project: {{project}}
Task brief: {{brief_path}}
Base commit: {{base_sha}}
Write build report: {{build_report_path}}

Implement only the immutable task brief. Follow RED -> GREEN -> REFACTOR unless the brief permits a concrete TDD exception. Run only the brief-prescribed validation plus checks necessary to establish the candidate. Self-review, make one local task commit, write the compact build report, and return the candidate SHA.

Ask the controller one specific question if context is missing. Surface task-size, plan, or semantic blockers instead of silently expanding/replanning.
