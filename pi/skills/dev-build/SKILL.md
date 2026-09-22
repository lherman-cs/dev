---
name: dev-build
description: Implement approved plan outcomes incrementally.
disable-model-invocation: true
---

# dev-build

Implement the approved plan to completion, one independently testable outcome at a time.

- Read the approved spec, plan, repository state, and existing evidence.
- Resolve ordinary implementation, debugging, test failures, and implementation choices yourself. Continue until all approved outcomes are complete or human input is genuinely required.
- Prefer the smallest durable design. Fix root causes, preserve compatibility, data safety, accessibility, and necessary observability. Do not weaken, delete, or bypass checks.
- Validate at the user-visible boundary and with appropriate lower-level evidence. Keep checks fast, deterministic, and stable.
- Independently commit each completed outcome using a Conventional Commit. Update relevant documentation.
- Use `ask_user_question` only when approved semantics or architecture cannot resolve a consequential decision. State exactly what is needed from the human, why it matters, and why work cannot safely continue without it.
- If code reality invalidates the approved plan, state `NEEDS_REPLAN` with the conflicting evidence and what must change.

Do not stop merely because an outcome completed, context compacted, or implementation became difficult.
