---
name: dev-plan
description: Turn an approved plans/<project>/spec.md into concrete isolated implementation plans under the same project directory. Use only when explicitly invoked after the destination has been specified.
---

# Dev Plan

Turn the approved spec into the safest concrete path from the current repository to that destination.

1. Resolve the project from the invocation and read `plans/<project>/spec.md` first.

2. Reuse relevant repository and session context already established.

3. Investigate the repository only until the implementation path is decision-complete:
   - ownership and data flow;
   - affected files, symbols, and call sites;
   - dependencies and lifecycle;
   - existing tests and verification;
   - constraints and conventions.

4. Resolve material repository questions through evidence rather than assumptions.
   Prefer targeted symbol, reference, and call-site investigation over broad repository reading.

5. Clearly distinguish repository facts from proposed implementation choices.

6. If the destination is materially insufficient or wrong, return to `dev-spec`
   rather than changing it here.

7. Decompose the work into the smallest useful ordered pieces that are independently:
   - implementable;
   - verifiable;
   - reviewable;
   - preferably committable.

8. Preserve buildability between pieces when practical and state dependencies otherwise.

Stop investigating once each piece can be implemented without rediscovering:

- architectural intent;
- ownership boundaries;
- affected implementation surfaces;
- required behavior;
- verification strategy.

Each plan contains only builder-relevant information:

- Objective
- Requirements satisfied
- Repository facts
- Changes
- Verification
- Done when
- Out of scope

Be concrete about files, symbols, data flow, and required behavior when supported by repository evidence.

Do not:

- repeat spec context that the builder can read directly;
- record investigation history;
- duplicate repository facts across plans unless needed by each builder;
- prescribe incidental implementation mechanics the builder can determine cheaply.

Before writing files, present a concise `DRAFT PLAN` decomposition containing:

- plan number and name;
- objective;
- major implementation surface;
- dependencies.

After explicit approval, write the full plans:

`plans/<project>/01-foo.md`
`plans/<project>/02-bar.md`
...

Done when each piece can be implemented without rediscovering architectural intent or implementation strategy.

Do not turn assumptions into repository facts.
Do not leave avoidable architectural investigation for the builder.
