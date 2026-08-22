---
name: dev-plan
description: Turn an approved plans/<project>/spec.md into concrete isolated implementation plans under the same project directory. Use only when explicitly invoked after the destination has been specified.
---

# Dev Plan

Turn the approved spec into the safest concrete path from the current repository to that destination.

1. Resolve the project from the invocation and read `plans/<project>/spec.md`.
2. Inspect the repository deeply enough to understand the implementation surface:
   - ownership and data flow;
   - relevant files, symbols, and call sites;
   - dependencies and lifecycle;
   - existing tests and verification;
   - constraints and conventions.
3. Resolve repository questions through investigation rather than assumptions.
4. Clearly distinguish repository facts from proposed implementation choices.
5. If the destination is materially insufficient or wrong, return to `dev-spec` rather than changing it here.
6. Decompose the work into the smallest useful ordered pieces that are independently:
   - implementable;
   - verifiable;
   - reviewable;
   - preferably committable.
7. Preserve buildability between pieces when practical and state dependencies otherwise.

Investigation should be deepest here. Resolve enough repository detail that build does not need to rediscover architecture or implementation strategy.

Each plan contains only what its builder needs:

- Objective
- Spec requirements satisfied
- Repository facts
- Changes
- Verification
- Done when
- Out of scope

Be concrete about files, symbols, data flow, and required behavior when supported by repository evidence.

Do not prescribe incidental implementation details the builder can determine cheaply.

Present the complete `DRAFT PLAN` decomposition before writing files.

After explicit approval, write:

`plans/<project>/01-foo.md`
`plans/<project>/02-bar.md`
...

Done when each piece can be implemented without rediscovering architectural intent.

Do not turn assumptions into repository facts.
Do not leave avoidable architectural investigation for the builder.
