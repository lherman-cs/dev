---
name: dev-spec
description: Define the desired end state for a substantial code change before implementation planning. Use only when explicitly invoked for architectural, ambiguous, or substantial work that needs a durable spec under plans/<project>/spec.md.
---

# Dev Spec

Define the destination, not the implementation path.

1. Resolve the project name from the invocation and target `plans/<project>/spec.md`.
2. Understand the task, supplied references, constraints, and explicit rejections.
3. Inspect the repository only as deeply as needed to define the destination correctly.
4. Resolve questions from repository evidence whenever possible.
5. Ask only consequential decisions the repository cannot resolve:
   - one at a time;
   - in dependency order;
   - recommend an answer when useful.
6. Stop investigating once the destination is decision-complete.

Keep the spec concise. Include only useful sections:

- Goal
- Requirements
- Invariants
- Non-goals / rejected designs
- Acceptance criteria

Exclude migration sequencing, file-by-file changes, and incidental implementation mechanics.

Present `DRAFT SPEC` before writing the file. Incorporate user decisions without silently expanding scope.

After explicit approval, write `plans/<project>/spec.md`.

Done when an engineer can judge whether an implementation reaches the intended destination without being told how to implement it.

Do not infer consequential requirements because one design seems obvious.
