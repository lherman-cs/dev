# OMP-native development workflow

## Design

OMP is the harness. Native slash commands coordinate native task agents; compact skills own reusable engineering semantics. Do not recreate capabilities OMP already provides.

Hard constraints:

- The human creates and manages worktrees.
- No custom orchestrator role, workflow extension, database, or durable model transcript.
- Git is implementation truth. The approved spec is semantic truth. GitHub is remote-candidate truth.
- Specialist work runs through OMP `task`; narrow read-only exploration uses bundled `scout`.
- Human gates use OMP `ask`. Live progress uses OMP `todo`.
- Shipping is bounded and restartable from Git, GitHub, and compact ignored project state.

## Human boundaries

There are three normal human decisions:

1. `/dev-spec`: approve intended behavior, invariants, scope, and non-goals.
2. `/dev-plan`: approve architecture and small execution contracts.
3. `/dev-ship`: approve the final exact candidate after automated convergence.

Use ordinary Markdown for review. Include a fenced Mermaid diagram only when relationships or flow are materially easier to review visually; OMP renders Mermaid natively. Use `ask` for the actual choice/approval rather than inventing another review UI.

## Lifecycle

```text
human creates worktree
        |
     /dev-spec
        |  dev-specifier + ask
     /dev-plan
        |  dev-planner + ask
     /dev-ship
        |
        |  BUILD
        |    sequential dev-builder tasks
        |    native todo shows progress
        |
        |  PREPARE
        |    dev-preparer publishes exact draft candidate
        |
        |  AWAIT
        |    shell/GitHub tooling waits for exact-HEAD terminal signals
        |
        |  REVIEW
        |    dev-reviewer
        |       |
        |       +-- repairs -> BUILD (bounded)
        |       +-- semantic ambiguity/non-convergence -> stop
        |       `-- pass -> HUMAN
        |
        |  HUMAN
        |    Markdown/Mermaid summary + ask
        |       |
        |       +-- feedback -> REVIEW/BUILD
        |       `-- approve -> finalize PR + mark ready
        |
        `-- DONE
```

`/dev-build`, `/dev-prepare`, and `/dev-review` are lower-level entry points for direct control or debugging.

## Durable state

All workflow artifacts are ignored under `plans/<project>/`:

```text
spec.md
project.toon
progress.toon
plans/P001.toon
plans/P002.toon
repairs/R001.toon
review.toon
```

Keep this state small:

- `spec.md`: approved semantic contract.
- `project.toon`: project identity/base, dependencies, final checks, readiness.
- `plans/*.toon`: immutable implementation contracts.
- `repairs/*.toon`: immutable review repair contracts.
- `progress.toon`: completed/current contract IDs and accepted HEAD for restart.
- `review.toon`: exact reviewed HEAD plus compact findings/approval state.

Do not persist CI logs, bot transcripts, source copies, generic event history, or model transcripts.

## Spec and plan

`/dev-spec` and `/dev-plan` delegate to `dev-specifier` and `dev-planner`. Those agents autoload the corresponding compact skill and may spawn `scout` for narrow investigation.

The worker prepares the artifact but never self-approves it. The parent session presents the decision-relevant result, optionally with Mermaid, and uses `ask`. Only the parent may write the approval marker after explicit human approval.

## Build

`/dev-build` reads approved plans/repairs and `progress.toon`, exposes the queue through native `todo`, and executes dependency-ready contracts sequentially.

Each contract gets one fresh `dev-builder` task. If independent verification fails, one `dev-builder-retry` attempt is allowed. The parent session verifies the contract checks, exactly one coherent Conventional Commit from the accepted predecessor, no workflow ID in the commit subject, a clean worktree, and then advances `progress.toon`.

A worker that returns `NEEDS_REPLAN`, or a second failed attempt, stops the build rather than widening scope.

## Prepare

`/dev-prepare` delegates operational publication to `dev-preparer`:

1. require completed contracts and a clean worktree;
2. fetch/rebase onto the configured base;
3. resolve only ordinary integration conflicts;
4. run final integration checks;
5. push with lease protection;
6. create/update a draft PR and report exact pushed HEAD/PR.

It does not adversarially review, wait for CI, or invent behavior fixes.

## Review

`/dev-review` gates on exact HEAD and terminal expected signals, then delegates to read-only `dev-reviewer`.

Review is bounded and conservative: concrete material correctness/spec/compatibility/proof gaps only. Red CI is evidence. Repairable findings carry stable root-cause keys and the smallest acceptance checks. Human selection/feedback uses native `ask`; only selected repairs become new immutable `Rxxx` contracts.

## Ship

`/dev-ship` composes the same build and prepare contracts, then waits for exact-HEAD GitHub signals with ordinary tooling rather than a polling subagent.

A fresh `dev-reviewer` examines the settled candidate. Automatic repair is limited to two rounds. A repeated root finding or unresolved semantic decision stops convergence.

After machine pass, the parent presents a concise exact-candidate summary, with Mermaid only if useful, and uses `ask` for final approval. Human feedback re-enters review; approval is recorded against exact HEAD before the PR is marked ready. Shipping never merges.

## Explorer

OMP's bundled `scout` is the universal read-only explorer. The user config routes it through `@explorer`. Main sessions and every workflow task agent may use it, including in parallel, while Agent Hub provides live visibility and steering.

Do not add another Explorer tool or copy scout behavior into skills.

## Instruction and model boundaries

- `~/.omp/agent/config.yml`: model roles and harness feature settings.
- `~/.omp/agent/commands/dev-*.md`: phase sequencing and human gates.
- `~/.omp/agent/agents/*.md`: worker model/tool/spawn boundaries.
- `~/.omp/agent/skills/dev-*/SKILL.md`: reusable role semantics.
- `plans/Pxxx.toon` / `repairs/Rxxx.toon`: one task's scope and acceptance checks.

Role/model choice is configuration, not workflow prose. Native OMP owns task scheduling, todo state, questions, Agent Hub, Mermaid rendering, and tool/runtime integration.
