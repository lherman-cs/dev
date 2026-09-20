# OMP-native deterministic development workflow

## Design

OMP is the harness. A small extension is the workflow driver. Fresh model workers own engineering judgment.

The invariant is:

> **Code decides workflow; models decide engineering.**

The driver must never outsource deterministic phase selection, retry policy, dependency ordering, progress updates, exact-HEAD checks, polling, or convergence control to a foreground orchestrator model.

OMP provides model roles, worker tool/runtime integration, bundled `scout`, Agent Hub, Mermaid rendering, and native human dialogs. The driver uses those primitives instead of reimplementing them.

## Lifecycle

```text
human creates worktree
        |
     /dev-spec
        |  direct @spec worker
        |  native OMP review/approval
     /dev-plan
        |  direct @plan worker
        |  native OMP review/approval
     /dev-ship
        |
        |  BUILD
        |    deterministic dependency selection
        |    direct @builder / @builder_retry workers
        |    independent commit/check verification
        |
        |  PREPARE
        |    deterministic fetch/rebase/final gates/push/draft PR
        |    direct worker only when a conflict needs judgment
        |
        |  AWAIT
        |    deterministic exact-HEAD GitHub polling
        |    no model tokens while waiting
        |
        |  REVIEW
        |    direct @review worker
        |    bounded repair convergence
        |
        |  HUMAN
        |    OMP ask dialog + Markdown/Mermaid preview
        |
        `-- FINALIZE
             direct @ship worker for PR prose only
             deterministic PR update + ready transition
```

There is no main-model relay between these phases.

## Worker invocation

The extension launches ephemeral OMP subprocesses directly using JSON mode and configured role aliases. Workers receive only the tools needed for their job plus OMP `task`/`hub`, allowing them to delegate narrow research to bundled `scout` without pushing that transcript into another coordinator model.

Specifier, Planner, Builder, Reviewer, conflict resolver, and finalizer are direct workers. Their output is consumed by deterministic code or presented directly to the human.

## Durable state

All artifacts are ignored under `plans/<project>/`:

- `spec.md`: approved semantic contract
- `project.toon`: project/base/dependencies/final checks/status
- `plans/*.toon`: immutable execution contracts
- `repairs/*.toon`: immutable repair contracts
- `progress.toon`: completed/current contract and accepted HEAD
- `ship.toon`: restartable phase, candidate identity, repair count, exact approved HEAD, recurrence guards
- `review.toon`: compact exact-HEAD review result

Do not persist raw model transcripts, CI logs, or generic event history.

## Build

`/dev-build` is a deterministic loop. It reconciles Git and `progress.toon`, skips superseded contracts, picks the next dependency-ready contract, launches one fresh `@builder`, and independently verifies exactly one Conventional Commit, clean worktree, declared checks, and no workflow metadata in the commit message.

A failed verification gets one `@builder_retry` attempt. `NEEDS_REPLAN` or a second failed attempt stops without widening scope.

## Prepare and await

Preparation is code-owned: fetch, rebase, final checks, repair planning for deterministic gate failures, force-with-lease push, and exact draft PR binding. A worker is launched only for semantic conflict resolution.

Await is ordinary GitHub polling bound to exact PR HEAD. No worker stays alive while waiting. A moved PR or base invalidates stale evidence rather than being silently accepted.

## Review and repair

A fresh direct `@review` worker receives the exact candidate evidence and returns structured PASS / REPAIRS / BLOCKED output. Deterministic code validates the structure, detects repeated stable finding keys, writes immutable repair contracts, and bounds automatic repair rounds.

Manual `/dev-review` uses the same direct Reviewer and OMP's native multi-select dialog so the human explicitly chooses which repairs become contracts.

## Human review

Spec, Plan, and final candidate review use OMP's native dialog surface. The preview is Markdown and may include fenced Mermaid when that reduces review effort. Feedback is sent directly back to the appropriate worker; approval is persisted only against the exact artifact/candidate being reviewed.

## Explorer

There is no custom Explorer implementation. Workers may call OMP's bundled `scout`, routed through `@explorer`. Agent Hub supplies visibility and steering.

## Instruction boundaries

- `~/.omp/agent/config.yml`: role/model and OMP feature policy
- `~/.omp/agent/extensions/dev-workflow.ts`: deterministic workflow mechanics
- `~/.omp/agent/skills/dev-*/SKILL.md`: reusable engineering semantics
- `plans/Pxxx.toon` / `repairs/Rxxx.toon`: one work item's contract
