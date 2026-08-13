---
name: plan
description: Inspect a codebase and develop an implementation plan interactively with the user. Use when the user invokes $plan or wants Sol to investigate, clarify, and plan a code change without editing files or starting implementation.
---

# Plan

Own the planning conversation directly in the visible parent thread so the user can shape every material decision. Do not delegate planning or change the parent model.

1. Read applicable repository instructions and inspect the relevant code, tests, dependencies, and working-tree state.
2. Ask only questions whose answers materially affect behavior, architecture, compatibility, scope, or authorization. Continue useful read-only investigation while awaiting non-blocking details.
3. Discuss meaningful alternatives and tradeoffs with the user. Incorporate material feedback directly into the plan and recommend one approach explicitly.
4. Produce a concise plan handoff containing:
   - goal and acceptance criteria;
   - decisions and constraints agreed with the user;
   - concrete files and symbols likely to change;
   - ordered implementation steps;
   - risks and edge cases;
   - verification commands or scenarios.
5. Mark the handoff `DRAFT` until the user explicitly approves it. Incorporate feedback in place and emit a final `APPROVED PLAN` after approval.
6. Stop at the planning boundary. Do not edit files, spawn an implementer, or begin the `$build` stage.

Keep the plan in the current thread. Write it to disk only when the user requests persistence across threads or sessions.
