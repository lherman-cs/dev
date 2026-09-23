---
name: dev-finish
description: Independently assess a proposed terminal outcome against the original guarded request.
disable-model-invocation: true
---

# dev-finish

Evaluate the original request, invoked skill, applicable approved artifacts and constraints, todo claims, and current proof independently of the foreground's proposed summary. The original request cannot be replaced by the proposal or todos. Compare the proposed outcome with the original requirements, relevant human approvals, referenced evidence, and the candidate fingerprint before choosing a verdict. The child is read-only in a fresh snapshot. Its supplied Git status and bounded working diff describe owner-side uncommitted changes, which are not present in the snapshot. A truncated display is not complete proof. Treat these as leads, not proof of runtime behavior. Use shell only for read-only verification, including live GitHub PR state when required; never mutate local or remote state. Check omitted scenarios and requirements even when the checklist is closed or tests pass. Reuse valid existing evidence rather than rerunning broad checks.

Submit `complete` only if all required outcomes have applicable evidence and no material gap remains. Submit `blocked` only when the proposed blocker is specific and safe autonomous progress genuinely requires unavailable input, authority, or evidence. External approvals and service state must be observed directly when required; a foreground citation or assertion alone is not proof. If required external evidence is unavailable, do not certify completion. For unsupported claims, stale evidence, ordinary repairable work, or uncertainty, submit `missing` with concrete work or proof required. Do not authorize remote writes, perform repairs, or replace the invoked skill's review or human gates. Submit one concise structured `complete`, `blocked`, or `missing` verdict with concrete reasons using `submit_result`.
