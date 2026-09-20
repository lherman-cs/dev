# OMP-native development workflow

## Principle

> **Code decides workflow; models decide engineering.**

The public workflow surface is symmetric:

```text
dev a <phase> [prompt...]
/dev-<phase> [args...]
```

Phases are `spec`, `plan`, `build`, `prepare`, `review`, and `ship`.

## Launcher semantics

`dev a <phase>` selects the phase role and starts OMP interactively without creating a user turn.

`dev a <phase> "prompt"` starts the exact same role and submits `/dev-<phase> prompt` as the initial action.

`dev a resume [session]` uses OMP's native continue/resume path while reapplying only the workflow config overlays; it does not replace the saved session model.

Role defaults:

| Phase | Model / thinking |
| --- | --- |
| spec | Sol medium |
| plan | Sol high |
| build | Sol low |
| build_retry | Sol medium |
| prepare | Luna medium |
| review | Astra low |
| ship | Luna medium |
| explorer | Luna medium |

## Slash commands

### Spec and Plan

`/dev-spec` and `/dev-plan` are thin aliases that send `/skill:dev-spec` and `/skill:dev-plan` back through OMP's normal prompt pipeline.

That means:

- work stays in the current interactive session and keeps its full conversation;
- no Specifier/Planner subprocess is created;
- the native OMP skill invocation path remains the single semantic implementation;
- the skill itself owns its feedback and explicit human-approval loop.

### Build

`/dev-build` is deterministic code:

1. reconcile Git with `progress.toon`;
2. skip superseded contracts;
3. choose the next dependency-ready `Pxxx` / `Rxxx`;
4. launch a fresh isolated `@build` worker with the `dev-implement` skill;
5. independently verify exactly one Conventional Commit, clean worktree, and declared checks;
6. retry once with `@build_retry` if verification fails;
7. persist accepted progress and repeat.

The foreground model does not relay worker results or choose workflow transitions.

### Prepare

`/dev-prepare` deterministically owns fetch/rebase/final checks/push/draft-PR binding. Ordinary mechanics consume no model tokens. If a rebase conflict needs judgment, the driver launches a bounded isolated worker.

### Review

`/dev-review` gathers exact candidate evidence and launches a fresh isolated `@review` worker. Structured findings are validated by code and concrete repairs are selected through OMP's native UI.

### Ship

`/dev-ship` is the restartable state machine:

```text
BUILD -> PREPARE -> AWAIT -> REVIEW/REPAIR -> HUMAN -> FINALIZE
```

`ship.toon` persists the phase, exact candidate, repair count, recurrence guards, and approved HEAD. Await is exact-HEAD GitHub polling and consumes no model tokens. Final PR prose uses the explicit `@ship` Luna-medium role.

## Configuration ownership

The repository **never** manages `~/.omp/agent/config.yml`.

Workflow-owned defaults live at `~/.omp/agent/dev-workflow.yml`. Both the CLI launcher and isolated workers pass that file as an OMP `--config` overlay.

## Workflow state

Durable workflow artifacts live under `plans/<project>/`:

- `spec.md`: approved semantic contract
- `project.toon`: project/base/dependencies/final checks/status
- `plans/*.toon`: immutable execution contracts
- `repairs/*.toon`: immutable repair contracts
- `progress.toon`: accepted work and HEAD
- `ship.toon`: restartable shipping state
- `review.toon`: compact exact-HEAD review result

The extension checks whether Git already tracks `plans/`. If not, it idempotently adds `/plans/` to `.git/info/exclude`. A project may be selected by name, its directory, `spec.md`, `project.toon`, or any plan/repair path inside it. It never requires or edits the repository's `.gitignore`.

## Explorer

There is no custom Explorer implementation. OMP's bundled `scout` is routed through the workflow `@explorer` role and is available to interactive phases and isolated workers.
