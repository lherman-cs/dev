# Planner dispatch: initial project plan

Use `dev-plan`.

Repository/worktree: {{repo}}
Project: {{project}}
Approved spec: {{spec_path}}
Current HEAD: {{head}}
Output plan: {{plan_path}}

Create the complete execution-grade plan from the current repository state. Check semantic prerequisites before elaborating implementation: resolve validation rules, defaults, and bounds to approved definitions or established contracts. Preserve accepted semantics exactly. Define baseline validation, meaningful sequential task gates, and final whole-project validation. Ensure Task 1 can reach one bounded verified candidate; set READY only after the bounded self-review required by `dev-plan`.

Do not implement. If the spec is semantically insufficient, return `SPEC CHANGE REQUIRED` with the exact missing decision and recommendation to the controller. A bounded human answer may be recorded inline in the spec; resume this assignment after the approved amendment without repeating unaffected discovery.
Keep detail that removes Builder rediscovery; omit source dumps and repeated workflow instructions. Return status, plan path, and only a concrete blocker/next action.
