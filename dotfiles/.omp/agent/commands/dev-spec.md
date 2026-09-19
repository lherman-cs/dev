---
description: Define and human-approve project semantics.
---

Run the spec phase for: $ARGUMENTS

Resolve the project/request from the argument and conversation; use native `ask` only if that identity or a consequential semantic choice is unresolved.

Delegate the semantic work with native `task` to `dev-specifier`. After it returns, read the draft spec and present only the decision-relevant summary. Include a fenced `mermaid` diagram only when it materially clarifies behavior or relationships.

Use native `ask` for feedback/final approval. Feed feedback into another `dev-specifier` task. Only explicit human approval may change `Status: APPROVED`. Stop after the approved spec.
