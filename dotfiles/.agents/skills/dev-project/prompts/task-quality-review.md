# Reviewer dispatch: task technical quality

Use `dev-review`.

Repository/worktree: {{repo}}
Task brief: {{brief_path}}
Builder report: {{build_report_path}}
Review package: {{review_package_path}}
Base: {{base_sha}}
Candidate: {{candidate_sha}}
Write report: {{review_report_path}}

Review **only technical quality** of this candidate: concrete bugs, edge cases, safety/security where relevant, technical architecture/maintainability inside the changed surface, and whether tests meaningfully exercise the assigned behavior. Do not reinterpret product semantics or request optional redesigns.

Use Critical/Important/Minor severity. Critical or Important blocks; Minor never blocks. Pre-existing unrelated defects cannot block. Normally trust Builder validation; run a targeted check only for a concrete unresolved doubt. Keep the report compact and findings-first with stable `Q#` IDs.
