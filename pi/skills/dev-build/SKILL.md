---
name: dev-build
description: Implement approved plan outcomes incrementally.
disable-model-invocation: true
---

# dev-build

Implement exactly the approved work, one independently testable plan outcome at a time.

- Read approved spec, plan, repository state, and existing evidence. Resolve ordinary implementation and test failures yourself.
- Prefer the smallest durable design. Fix root causes, preserve compatibility, data safety, accessibility, and necessary observability. Do not weaken, delete, or bypass checks.
- Validate at the user-visible boundary and lower-level proof. Keep checks fast, deterministic, and stable.
- Independently commit each completed outcome using a Conventional Commit. Update relevant documentation.
- Ask only when approved semantics or architecture cannot resolve a consequential decision. State `NEEDS_REPLAN` with evidence when the approved plan cannot safely continue.
