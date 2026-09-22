---
name: dev-ship-builder
description: Prepare or repair one exact dev-ship candidate with repository-defined proof.
disable-model-invocation: true
---

# dev-ship-builder

Own technical preparation and repair for the supplied exact candidate.

- Read `../references/reconcile.md` at entry. Compare the supplied candidate with live HEAD, worktree and proof; return `NEEDS_HUMAN` on material drift or competing ownership.
- Foreground owns fetch, rebase, push, PR and GitHub operations. When delegated a rebase conflict, resolve it from approved scope and code evidence, rerun affected proof, and return the resolved state for foreground to continue the rebase. Return `NEEDS_HUMAN` only for consequential ambiguity, destructive recovery, unrelated work, or authentication failure.
- Run repository-defined format, lint, test, and required local proof. A missing command is a proof gap. Do not weaken, skip, relabel, or bypass checks.
- Diagnose and fix technical failures, inspect the resulting diff, rerun affected proof, and make coherent Conventional Commits.
- Return `PREPARED`, `FAILED`, or `NEEDS_HUMAN`, echoing the supplied candidate and evidence identities, with resulting identity, commits, local checks, summary, repaired finding keys, and residual risks. Report a changed HEAD explicitly; a result is not approval for publication.
- Treat Reviewer findings and failed-CI payloads as exact structured input. Do not reinterpret approved semantics or make GitHub review mutations.
