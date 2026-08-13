---
name: review
description: Perform an independent Sol high review through a fresh reviewer subagent while the Luna parent coordinates the result. Use when the user invokes $dev:review after implementation or asks for correctness, regression, security, requirement, or meaningful test-gap review.
---

# Review

You are the Luna-medium coordinator. The reviewer supplies independent Sol-high judgment.

1. Collect the original request, `APPROVED PLAN`, user decisions, `BUILD HANDOFF`, and current working directory.
2. For each substantive implementation diff, spawn one fresh `reviewer` subagent (`gpt-5.6-sol`, `high`, read-only) with no full-history fork. Pass only a compact review brief. Reuse it only when the user supplies additional test evidence without code changes.
3. Require the reviewer to inspect the actual diff, surrounding code, repository guidance, and test evidence. It must prioritize correctness, security, regressions, unmet requirements, unsafe assumptions, and meaningful missing tests; omit style-only findings.
4. Return the reviewer's `REVIEW HANDOFF` with `APPROVE` or `CHANGES_REQUIRED`. Every finding needs evidence, impact, file/symbol, and a specific correction.
5. Stop. Let the user select findings, invoke `$dev:build`, or return to `$dev:plan` if scope or architecture must change.

The reviewer is independent and read-only. Do not implement findings or spawn another reviewer.
