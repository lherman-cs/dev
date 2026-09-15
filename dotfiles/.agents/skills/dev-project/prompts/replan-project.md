# Planner dispatch: material replan

Use `dev-plan`.

Repository/worktree: {{repo}}
Project: {{project}}
Approved spec: {{spec_path}}
Current plan: {{plan_path}}
Progress ledger: {{progress_path}}
Current HEAD: {{head}}
Contradicted dependency/interface/strategy and affected tasks: {{reason}}

Replan from actual current repository state. Preserve already accepted work that remains valid. Rewrite the single `plan.md`; do not create versioned plan files. Do not change product semantics. Return `SPEC CHANGE REQUIRED` if the discovery requires a semantic decision.
Inspect only the concrete defect and affected interfaces; preserve unaffected task text and usable baseline evidence. Routine command/setup corrections and size-only operational splits belong to the controller; return those for a ruling without rewriting the plan. Return status, plan path, and only a concrete blocker/next action.
