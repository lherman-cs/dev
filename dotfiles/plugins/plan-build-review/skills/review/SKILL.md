---
name: review
description: Independently review an implemented code change with Sol against its approved plan and actual diff. Use when the user invokes $review after implementation or asks for correctness, regression, security, requirement, and meaningful test-gap review without modifying files.
---

# Review

Own only independent review. Never edit files or silently send findings for implementation.

1. Gather the latest `APPROVED PLAN`, user decisions, and `BUILD HANDOFF` from the current thread. Inspect the actual working-tree diff; do not rely only on the build summary.
2. Spawn the custom `reviewer` agent using `gpt-5.6-sol` with `high` reasoning and a read-only mandate. Give it the original request, approved plan, build handoff, working directory, and applicable repository instructions.
3. Require the reviewer to inspect relevant surrounding code and test evidence. Prioritize correctness, security, regressions, unmet requirements, unsafe assumptions, and meaningful missing tests. Exclude style-only feedback.
4. Return a `REVIEW HANDOFF` with an `APPROVE` or `CHANGES_REQUIRED` verdict. For every finding, include evidence, impact, file and symbol references, and a specific correction.
5. Stop at the review boundary. Do not edit code, start implementation, or begin another stage.

Let the user decide whether to accept the result, revise the plan, or invoke `$build` to address selected findings.
