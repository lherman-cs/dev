# OMP-native development workflow

## Principle

> **Code decides workflow; models decide engineering.**

Interactive semantic work uses `dev a`; deterministic execution/convergence uses the OMP extension.

## Interactive roles

```text
dev a spec [prompt]
dev a plan [prompt]
dev a resume [session]
```

- Bare Spec/Plan selects `@spec` / `@plan` and starts an interactive OMP session without inventing a user turn.
- With a prompt, the launcher submits OMP's native `/skill:dev-spec` / `/skill:dev-plan` startup command under that role.
- Resume applies the workflow config overlays but does not replace the resumed session's saved role/model.
- Spec/Plan skills own their human feedback/approval loop and persist approved artifacts directly.

## Deterministic phases

```text
/dev-build
    deterministic dependency selection
    -> fresh @builder
    -> independent commit/check verification
    -> at most one @builder_retry

/dev-prepare
    deterministic fetch/rebase/final gates/push/draft PR
    -> worker only when merge-conflict judgment is necessary

/dev-review
    fresh @review
    -> structured findings
    -> native human repair selection

/dev-ship
    BUILD -> PREPARE -> AWAIT -> REVIEW/REPAIR -> HUMAN -> FINALIZE
```

`/dev-ship` persists `ship.toon` so interruption/restart does not require an orchestrator transcript. Await is exact-HEAD GitHub polling and consumes no model tokens.

## Isolation

Builders, retries, Reviewers, conflict resolvers, and PR finalizers are ephemeral OMP JSON workers. The driver consumes their bounded output directly. Workers receive OMP `task`/`hub`, so they may use bundled `scout` for narrow research without pushing that transcript through another model.

## Configuration ownership

The repository never manages `~/.omp/agent/config.yml`.

Workflow role defaults live in `~/.omp/agent/dev-workflow.yml`; optional user overrides live in `~/.omp/agent/dev-workflow.local.yml`. Both the launcher and isolated workers pass them to OMP with repeatable `--config` overlays. This keeps workflow model routing independent from the user's normal OMP preferences.

## Workflow state

Durable state is ignored under `plans/<project>/`:

- `spec.md`: approved semantic contract
- `project.toon`: project/base/dependencies/final checks/status
- `plans/*.toon`: immutable execution contracts
- `repairs/*.toon`: immutable repair contracts
- `progress.toon`: completed/current work and accepted HEAD
- `ship.toon`: restartable shipping phase/candidate/repair count/approved HEAD
- `review.toon`: compact exact-HEAD review result

The extension automatically adds `/plans/` to `.git/info/exclude` when the repository does not already ignore it. Repository `.gitignore` is untouched. If Git already tracks `plans/`, the workflow stops rather than colliding with product files.

## Explorer

There is no custom Explorer implementation. OMP's bundled `scout` is routed through the workflow overlay's `@explorer` role and is available from interactive roles and isolated workers.
