# Strong Reviewer dispatch: final whole-project review

Use `dev-review`.

Repository/worktree: {{repo}}
Approved spec: {{spec_path}}
READY plan: {{plan_path}}
Progress/rulings/deferred Minors: {{progress_path}}
Full project review package: {{review_package_path}}
Project base: {{base_sha}}
Final candidate: {{candidate_sha}}
Full-project validation evidence: {{validation_evidence}}
Write report: {{review_report_path}}

Perform one fresh integrated review of the final candidate: whole-spec compliance, cross-task interactions, architecture/invariants, regressions/edge cases, technical quality, controller rulings, and whether deferred Minors remain genuinely Minor in integrated context.

Do not mechanically replay every task review or load historical `work/` reports unless a concrete final-review question requires one. Use Critical/Important/Minor severity and compact `F#` finding IDs.
