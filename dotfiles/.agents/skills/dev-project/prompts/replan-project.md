# Planner dispatch: material replan

Use `dev-plan`.

Repository/worktree: {{repo}}
Project: {{project}}
Approved spec: {{spec_path}}
Current plan: {{plan_path}}
Progress ledger: {{progress_path}}
Current HEAD: {{head}}
Concrete plan defect/discovery: {{reason}}

Replan from actual current repository state. Preserve already accepted work that remains valid. Rewrite the single `plan.md`; do not create versioned plan files. Do not change product semantics. Return `SPEC CHANGE REQUIRED` if the discovery requires a semantic decision.
