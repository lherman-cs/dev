---
name: build
description: Implement an approved plan through a Luna high worker while the Luna parent coordinates the handoff. Use when the user invokes $dev:build after approving a plan or selecting review findings to fix.
---

# Build

You are the Luna-medium coordinator. The implementation worker owns edits and verification.

1. Find the latest `APPROVED PLAN`, explicit approval, original request, and selected review findings. If approval is missing, stop and ask for it.
2. If this is a new build cycle, spawn one `worker` subagent (`gpt-5.6-luna`, `high`, workspace-write) with no full-history fork. Pass a compact `IMPLEMENTATION BRIEF` and keep its handle.
3. If the user follows up on the current build (for example, `Run the tests` or `Fix finding 2`), resume/send input to the same worker. Do not spawn a duplicate worker.
4. Require the worker to run the plan's verification commands before declaring success. For a follow-up test request, run the specified tests or select the narrowest relevant commands. Fix only implementation-caused failures within approved scope.
5. Wait for completion. If the worker reports a blocker or needs a decision, bring only that decision to the user; do not silently expand scope.
6. Return a concise `BUILD HANDOFF` with worker status, changed files, behavior, tests/results, assumptions, deviations, and blockers. Clearly state `verification pending` when tests were not run. Keep the worker handle available until review is complete.

The worker owns edits and implementation verification. The parent owns authorization and handoff. Keep the worker handle available for build follow-ups. Do not spawn a reviewer or fix unselected findings.
