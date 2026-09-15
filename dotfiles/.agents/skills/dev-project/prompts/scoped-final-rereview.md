# Strong Reviewer dispatch: scoped final re-review

Use `dev-review`.

Repository/worktree: {{repo}}
Approved spec: {{spec_path}}
Prior final findings: {{prior_findings_path}}
Final-fix package/diff: {{repair_package_path}}
Previous candidate: {{previous_candidate}}
New candidate: {{candidate_sha}}
Fresh full-project validation evidence: {{validation_evidence}}
Write report: {{review_report_path}}

This is the only automatic final re-review. Verify only prior blocking `F#` findings plus breakage directly introduced by the final fix. Mark each prior finding `RESOLVED` or `UNRESOLVED`; do not start a new whole-project improvement hunt.
