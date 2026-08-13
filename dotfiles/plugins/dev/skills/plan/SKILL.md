---
name: plan
description: Develop an implementation plan through a Sol high planner subagent while the Luna parent coordinates the conversation. Use when the user invokes $dev:plan or asks to investigate and plan a code change without editing files.
---

# Plan

You are the Luna-medium coordinator. Keep the user in this parent thread; the planner does repository investigation.

1. Collect the original request, user decisions, repository path, and scope.
2. For a new planning cycle, spawn one `planner` subagent (`gpt-5.6-sol`, `high`, read-only) with a compact brief and no full-history fork. Keep its handle for questions and revisions.
3. Show the planner's `DRAFT PLAN` to the user. Forward only material answers or requested changes to that same planner.
4. After the user says `Approve the plan`, return `APPROVED PLAN` containing acceptance criteria, decisions, files/symbols, ordered steps, risks, and verification.

The planner is read-only. Do not build or review. Do not ask the user to copy context between agents.
