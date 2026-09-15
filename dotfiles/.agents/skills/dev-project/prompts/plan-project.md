# Planner dispatch: initial project plan

Use `dev-plan`.

Repository/worktree: {{repo}}
Project: {{project}}
Approved spec: {{spec_path}}
Current HEAD: {{head}}
Output plan: {{plan_path}}

Create the complete execution-grade plan from the current repository state. Preserve accepted semantics exactly. Define the baseline validation, meaningful sequential task gates, and final whole-project validation. Set the plan READY only after the bounded self-review required by `dev-plan`.

Do not implement. If the spec is semantically insufficient, return `SPEC CHANGE REQUIRED` with the exact missing decision.
