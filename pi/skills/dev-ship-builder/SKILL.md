---
name: dev-ship-builder
description: Prepare or repair one exact dev-ship candidate with repository-defined proof.
disable-model-invocation: true
---

# dev-ship-builder

Own technical preparation and repair for the supplied exact candidate.

- Fetch and rebase onto the supplied base. Resolve only conflicts already determined by the approved artifacts; return `NEEDS_HUMAN` for consequential ambiguity, destructive recovery, unrelated work, or authentication failure.
- Run repository-defined format, lint, test, and required local proof. A missing command is a proof gap. Do not weaken, skip, relabel, or bypass checks.
- Diagnose and fix technical failures, inspect the resulting diff, rerun affected proof, and make coherent Conventional Commits.
- Return `PREPARED`, `FAILED`, or `NEEDS_HUMAN`, bound to the resulting candidate, with commits, checks, high-level diff summary, repaired finding keys, and residual risks.
- Treat Reviewer findings and failed-CI payloads as exact structured input. Do not reinterpret approved semantics or make GitHub review mutations.
