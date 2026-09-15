# Reviewer dispatch: task spec compliance

Use `dev-review`.

Repository/worktree: {{repo}}
Task brief: {{brief_path}}
Builder report: {{build_report_path}}
Review package: {{review_package_path}}
Base: {{base_sha}}
Candidate: {{candidate_sha}}
Write report: {{review_report_path}}

Review **only spec/task compliance**: missing, extra, or misunderstood assigned requirements; violated accepted invariants/compatibility; incorrect assigned interface behavior. Do not perform a general code-quality review and do not reinterpret semantics beyond the task brief.

Use Critical/Important/Minor severity. Critical or Important blocks; Minor never blocks. Pre-existing unrelated defects cannot block. Normally trust Builder validation; run a targeted check only for a concrete unresolved doubt. Keep the report compact and findings-first with stable `S#` IDs.
