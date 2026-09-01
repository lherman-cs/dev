---
name: dev-build
description: Implement one approved coarse plan completely in a dedicated primary-thread chat, verify the final result, and create one coherent commit. Use with plans/<project>/<NN>-*.md.
---

# Dev Build

Own one approved plan end to end as a senior software engineer.

Stay in the current primary thread. Do not spawn subagents. One chat implements
exactly one numbered plan and creates one commit; do not continue into the next
plan.

## Start from the contract

Resolve and read the requested `plans/<project>/<NN>-*.md` first.

- Read the sibling `spec.md` only when the plan omits a consequential
  requirement or repository evidence appears to contradict it.
- Read an earlier plan only when the requested plan explicitly depends on
  details not visible in the current repository state.
- Inspect `git status` before editing. Preserve unrelated user changes; never
  silently absorb, discard, or overwrite them.
- Inspect only the code and supporting docs needed for this deliverable.
  Prefer plan facts and targeted symbol or call-site searches over broad
  rediscovery.

The plan is a design contract, not an edit script. It owns the outcome, scope,
consequential decisions, invariants, and required evidence. You own ordinary
implementation judgment.

Do not create a microtask plan or ask for approval between implementation
steps. Proceed unless consequential user judgment is genuinely required.

## Implement continuously

Complete the whole deliverable in this chat.

- Make the simplest coherent implementation that satisfies the plan.
- Follow the change through all implied call sites, migrations, displaced-path
  cleanup, and failure handling required for the outcome.
- Keep implementation, debugging, and correction in one continuous context.
  Do not create artificial batches or checkpoints.
- Add or update the narrowest durable regression evidence needed for changed
  behavior, unless existing tests already prove it. Do not manufacture a RED
  ceremony for mechanical work.
- Leave adjacent improvements and unrelated cleanup out of the change.
- Do not reopen settled architecture, rewrite the plan, or weaken its
  requirements merely because implementation is difficult.

A large but bounded rewrite, temporary non-compilation, failures caused by
current edits, or additional local work already implied by the plan are normal
implementation states—not reasons to stop or return to planning.

Stop only when repository evidence shows that the approved outcome or
consequential strategy is materially wrong, overlapping user changes make
isolated implementation unsafe, or required tooling/access is genuinely
unavailable. Report exact evidence; do not silently redesign the project.

## Verify proportionally

During implementation, run the cheapest targeted check that can falsify the
current change. Prefer focused tests, exact simulation scenarios or seeds,
package checks, and narrow integration probes over repeated broad suites.

For commands likely to produce large output, use this skill's
`scripts/quiet-run` helper when practical. On success, retain only the concise
result in context. On failure, inspect the smallest useful diagnostic region,
then expand only as needed.

Before completion:

1. Re-read the plan and check every required outcome against the current tree.
2. Inspect the scoped final diff, including changed success, failure,
   ownership, and cleanup paths.
3. Try to falsify the implementation against the plan's invariants and
   acceptance evidence.
4. Run the plan's required final validation once on the unchanged final tree.

Do not rerun successful checks on an unchanged tree without a concrete reason.
Do not separately rerun constituent suites when a successful umbrella command
covers them. Never weaken a test, oracle, or threshold merely to obtain green
output.

Passing tests do not prove that all planned work is present. Partial
implementation is not a valid result.

## Commit and stop

Stage only this deliverable. Create one commit after the plan is complete and
verified.

Use Conventional Commits v1.0.0 with a useful subject and, for substantial
changes, a concise body describing the resulting behavior or ownership change.
Do not use plan numbers or filenames as the commit subject.

After the commit, stop. The next numbered plan belongs in another dedicated
primary-thread chat.

Report only:

- **Changed** — delivered outcome.
- **Verified** — final relevant evidence.
- **Commit** — hash and subject.
- **Notes** — only material deviations, accepted gaps, or risks.

If blocked, report only the contradiction, its evidence, and whether the
project must return to `$dev-plan`.

Never end with a progress-only result such as “in progress,” “the remaining
work is substantial,” or “the workspace currently compiles.” Continue until
complete or concretely blocked.
