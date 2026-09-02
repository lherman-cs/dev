---
name: dev-build
description: Implement exactly one approved numbered plan completely in a fresh build session, verify it, and create one coherent commit. Use with plans/<project>/<NN>-*.md
---

# Dev Build

Own exactly one approved implementation plan end to end as a senior software
engineer.

This skill runs in a fresh dedicated build session. Do not spawn subagents.
Do not implement more than one numbered plan. After the commit, stop.

The repository, project spec, plan, and affected ownership documentation are
the source of truth. Previous planning or build conversations are not required
context.

## Start from the contract

Resolve the exact requested:

`plans/<project>/<NN>-*.md`

Do not infer "the next plan" from conversation history when an exact plan can
be resolved from the repository.

Before editing:

1. Read the requested plan completely.
2. Read its sibling `spec.md`.
3. Read the ownership README for directly affected modules and follow only the
   architecture links relevant to this plan.
4. Inspect `git status`.
5. Inspect the current implementation and relevant call sites narrowly enough
   to understand the change.

Preserve unrelated user changes.

Do not broadly rediscover the repository when the plan and module
documentation already establish the boundary.

The plan owns the required outcome, constraints, and acceptance evidence.
Repository architecture documentation owns durable system boundaries.
You own ordinary implementation judgment.

If the plan materially contradicts current authoritative repository evidence,
stop before broad implementation and report the exact contradiction. The
project must return to `$dev-plan`.

Do not silently redesign a consequential architecture decision inside
`$dev-build`.

## Work efficiently

Implement the smallest coherent solution that fully satisfies the plan.

Optimize model/tool interaction for useful information rather than maximum
activity.

### Batch investigation

Before editing, gather enough related evidence to form a coherent
implementation model.

Prefer:

* targeted symbol and call-site searches;
* reading several directly related small files together;
* one search that answers several related questions;
* current interfaces and tests over historical investigation.

Avoid repeated:

`search → think → search → think → search`

when the relevant investigation can be performed together.

Do not dump whole large files, generated trees, build directories, or broad
logs into context when a targeted range or search is sufficient.

### Batch edits

Make related edits as one coherent change when their required shape is already
understood.

Do not repeatedly patch and re-read the same small region without a concrete
new failure or discovery.

Follow the change through all required call sites, failure paths, cleanup,
tests, and displaced implementation required by the plan.

Leave adjacent improvements out.

### Keep command output small

For commands likely to produce large output, use the available quiet wrapper
or equivalent concise execution path.

On success, retain only the concise result.

On failure:

1. inspect the smallest useful diagnostic;
2. identify the failing component;
3. expand logs only when the smaller diagnostic is insufficient.

Do not repeatedly feed identical compiler, test, or repository output back
into context.

## Validate proportionally while implementing

Use the cheapest check that can falsify the current coherent change.

Prefer, in order when appropriate:

1. focused unit or scenario test;
2. affected package/crate check;
3. narrow integration or interoperability test;
4. broader project/repository gate.

Do not run a broad suite after every edit.

Do not rerun a successful check on an unchanged relevant tree without a
specific reason.

A failing test is evidence to investigate, not permission to weaken the test,
oracle, threshold, invariant, or requested behavior.

Distinguish failures introduced by this plan from known baseline failures using
repository evidence rather than repeatedly rediscovering them.

## Control scope and context growth

The build session exists only for this numbered plan.

Do not:

* continue into the next plan;
* reopen settled architecture without contradictory evidence;
* add optional cleanup;
* perform unrelated refactors;
* investigate future milestones;
* generate a new roadmap;
* spawn reviewer or builder subagents.

If implementation exposes additional work, decide whether it is:

* necessary to satisfy this plan: complete it here;
* an architectural contradiction: stop and return to `$dev-plan`;
* an independent outcome: leave it for another plan.

Context compaction is a warning that the work order or debugging loop may be
too large.

If compaction occurs:

1. reassess the remaining work immediately;
2. stop broad exploration;
3. continue only when the remaining path is narrow and the plan can be
   completed without materially reopening the design.

If substantial independent work remains, preserve the coherent repository
state and report that the plan needs to be split or replanned rather than
entering another long exploratory loop.

Never use context availability as justification to broaden scope.

## Add convincing evidence

Add or update the narrowest durable regression evidence required by changed
behavior unless existing tests already prove it.

Tests should assert externally meaningful behavior or durable invariants rather
than temporary implementation details.

For interoperability boundaries, use the independent implementation or
environment required by the plan rather than replacing it with an internal
mock that cannot prove the real contract.

Do not manufacture test ceremony for purely mechanical work when existing
validation already proves it.

## Final verification

Once implementation appears complete:

1. Re-read the numbered plan.
2. Check every outcome, scope item, constraint, and verification requirement
   against the final tree.
3. Inspect the complete scoped diff.
4. Inspect important success, failure, ownership, and cleanup paths.
5. Try to falsify the implementation against the project spec and module
   invariants.
6. Run focused final validation on the unchanged final tree.
7. Run broader required gates once when the plan or repository policy requires
   them.
8. Run `git diff --check` or the repository equivalent.

Passing tests alone do not prove plan completeness.

Do not repeatedly rerun successful final gates on an unchanged tree.

## Commit

Stage only the changes belonging to this plan.

Create one coherent commit after the implementation and required verification
are complete.

Use Conventional Commits v1.0.0 with a useful behavioral subject. For a
substantial change, include a concise body describing the resulting behavior
or ownership change.

Do not use the plan number or filename as the commit subject.

After committing, inspect the resulting status and confirm unrelated user work
was not accidentally included.

## Handoff

Report only:

* **Changed** — the delivered plan outcome.
* **Verified** — final relevant evidence and any repository gate results.
* **Commit** — hash and subject.
* **Notes** — only material deviations, known external baseline failures, or
  risks.

If blocked by an architectural contradiction, report:

* the contradiction;
* concrete evidence;
* why the approved plan cannot safely continue;
* that it must return to `$dev-plan`.

Then stop.

Do not begin another numbered plan in this session.
Do not perform `$dev-review` in this session.
