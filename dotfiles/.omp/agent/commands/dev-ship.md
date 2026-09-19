---
description: Drive approved plans to a reviewed, human-approved ready PR.
---

Ship project: $ARGUMENTS

Use native `todo` with phases Build, Prepare, Await, Review, Human, Finalize.

Resolve the active OMP agent directory with `omp config path`, read `commands/dev-build.md` and follow its build contract, then read `commands/dev-prepare.md` and follow its prepare contract.

For Await, use ordinary GitHub/shell tooling to wait for the exact PR HEAD until expected checks are terminal and review feedback has settled. Do not spend subagent turns polling. If the PR HEAD moves unexpectedly, stop.

For Review, spawn a fresh `dev-reviewer`. PASS advances. BLOCKED stops. For REPAIRS, write the smallest immutable repair batch and re-enter Build. Allow at most two automatic repair rounds; a repeated stable finding key stops rather than looping.

After PASS, present a concise exact-candidate human review: user-visible behavior, architecture/flow changes, validation, material risks, and repair history. Include fenced `mermaid` only if it improves comprehension. Use native `ask` for approval or feedback. Feedback goes through a fresh `dev-reviewer` and may produce repairs or BLOCKED; it may not silently pass.

On explicit approval, record the approved exact HEAD in `review.toon`, update the PR title/body concisely, and mark the draft ready. Never merge.
