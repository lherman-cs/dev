# dev toolbox

Personal development toolbox plus an OMP-native engineering workflow with a deterministic driver.

## Workflow

You create the Git worktree yourself. The normal workflow is:

```text
/dev-spec
    direct Specifier worker -> OMP review/approval
/dev-plan
    direct Planner worker -> OMP review/approval
/dev-ship
    deterministic build -> prepare -> await -> review/repair -> human approval -> ready PR
```

`/dev-build`, `/dev-prepare`, and `/dev-review` remain available as lower-level commands.

The core invariant is:

> **Code decides workflow; models decide engineering.**

The OMP extension owns dependency ordering, retries, state recovery, exact-commit validation, rebase/GitHub sequencing, CI waiting, repair convergence, and final approval binding. It launches fresh model workers directly with OMP's non-interactive JSON mode, so there is no foreground orchestrator model relaying every skill or worker result.

OMP still owns the harness capabilities that should not be duplicated locally:

- model roles
- `task` / bundled `scout` for worker-local exploration
- Agent Hub
- LSP/GitHub/browser/web tooling
- Markdown + Mermaid rendering
- native review dialogs

Durable workflow state stays ignored under `plans/<project>/`:

```text
spec.md
project.toon
progress.toon
ship.toon
plans/P001.toon
repairs/R001.toon
review.toon
```

Git remains implementation truth; the approved spec remains semantic truth.

## Models

Role/model routing is native OMP configuration in:

```text
~/.omp/agent/config.yml
```

The driver launches `@spec`, `@plan`, `@builder`, `@builder_retry`, `@review`, and `@ship` directly. Any worker may delegate narrow read-only research to bundled `scout`, which is routed through `@explorer`.

See [WORKFLOW.md](WORKFLOW.md) for the contracts.

## Bootstrap

```sh
bash <(curl -L https://raw.githubusercontent.com/lherman-cs/dev/main/install.sh)
```

The installer installs OMP and TOON, links the dotfiles, and removes retired Pi assets plus the temporary prompt-relay OMP commands/agents from the first migration.
