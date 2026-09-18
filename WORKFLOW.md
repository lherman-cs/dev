# Pi-first development workflow

## Design constraints

The workflow is intentionally easy to change as we learn. Pi is the harness; skills contain semantic role instructions; a single small extension supplies rich UI, isolated child-agent execution, model routing, Explorer, and deterministic build progress. Do not grow this into a generic workflow engine.

Hard constraints:

- The human creates/manages worktrees.
- No orchestrator agent.
- No SQLite/database/event log.
- No durable model transcripts or copied source/diffs/logs.
- No per-plan LLM review.
- No automatic build -> review -> repair loop. The human invokes every major stage.
- New implementation work enters through an approved plan or approved review repair.
- Git is implementation truth; the approved spec is semantic truth.

## Skill boundary

`WORKFLOW.md` owns lifecycle sequencing. Individual skills own only their stage contract: prerequisites, work, outputs, and stop conditions. A skill may explain why it stopped, but it must not select, invoke, or conditionally route to another workflow skill. The human chooses the next stage. This keeps skills independently revisable and prevents the workflow graph from being duplicated across prompts.

## Lifecycle

```text
human creates worktree
        |
     /dev-spec
        |  rich spec brief + explicit human approval
     /dev-plan
        |  rich plan brief + explicit human approval
     /dev-build
        |  fresh visible Builder / plan or repair / commit
   /dev-prepare
        |  rebase + local final checks + push/update DRAFT PR
        |  STOP -- no waiting
        v
   CI + review bots run asynchronously
        |
   human waits until relevant signals are terminal
        |
    /dev-review
        |  consumes CI RED/GREEN + bot/PR feedback + diff + spec + tests
        |  adversarial review + rich human brief
        |
        +-- PASS -------------------------------> /dev-ship
        |
        `-- repairs proposed
              | rich repair brief: inspect/filter/feedback
              | explicit human approval
              v
         repairs/Rxxx.toon
              |
          human invokes /dev-build
              |
          /dev-prepare -> external signals -> /dev-review
```

Nothing automatically crosses the human-trigger boundaries.

## Human review UX is a primary product requirement

Spec, Plan, and Review/Repair must feel closer to a modern web review page than a traditional terminal prompt. `workflow_brief` is a reusable Pi TUI surface and should support:

- fullscreen responsive panes/tabs/cards/tables/trees;
- rich Markdown and syntax-readable code/data;
- architecture/data-flow diagrams;
- before/after representations where useful;
- optional inline screenshots/images when they materially improve understanding;
- mouse and keyboard navigation;
- collapsible/drill-down organization and concise evidence links;
- selectable repair proposals plus a feedback path;
- graceful fallback when the terminal cannot render an image.

Spend model tokens on understanding and concise human communication, not HTML/CSS/layout boilerplate. The model emits semantic sections/diagrams/repairs; the extension renders them. Richness and human review speed matter more than minimizing every presentation token.

## Explorer is a first-class primitive

`explore` is available to intelligent workflow roles, including Builder children. Explorers are fresh, narrow, read-only, cheap, evidence-oriented subagents. They should be heavily used when they reduce the parent model's context or latency.

Good fan-out examples:

- repository code paths/invariants/symbol ownership;
- diff impact and compatibility questions;
- CI failure diagnosis and minimal relevant log evidence;
- completed bot/PR feedback synthesis;
- tests/coverage gaps;
- current upstream/API documentation and primary references.

Prefer several narrow Explorer tasks in parallel over one broad research session. The parent gets compact `Conclusion / Evidence / Uncertainty` packets, never full child transcripts. Explorer activity is visible in Pi. External-capability Explorers may use read-only `gh`, `curl`, and Git commands; the extension blocks obvious mutation commands.

## Artifacts

All workflow artifacts are ignored under `plans/<project>/`:

```text
spec.md                   semantic authority; human approved
project.toon              project/base/dependencies/final checks/status
progress.toon             tiny extension-owned execution pointer
plans/P001.toon           immutable approved implementation contract
plans/P002.toon
repairs/R001.toon         immutable human-approved review repair contract
review.toon               compact exact-HEAD review state/provenance
```

Do not store raw CI logs, bot transcripts, LLM transcripts, source copies, giant summaries, or generated HTML.

`progress.toon` contains only the minimum needed to resume deterministic build driving: project, completed work IDs, current work ID, and accepted HEAD. Human Git edits are reality; the workflow never resets/cleans them away.

## Spec

`/dev-spec` starts semantic alignment. Specifier inspects reality, challenges assumptions, records decisions/non-goals/invariants/acceptance evidence, and may propose splitting the request into independently mergeable/testable projects. The human decides and creates any additional worktrees.

Before approval, Specifier must render the rich Pi spec brief. Feedback returns directly to Specifier. Only explicit human approval marks `spec.md` APPROVED.

## Plan

`/dev-plan` compiles the approved spec into small execution contracts. One plan is the smallest coherent independently testable outcome suitable for one fresh Builder session and one commit. Planner owns plan TOON; Builders never edit plans.

A dispatched plan is immutable. If a material assumption is contradicted, create replacement IDs for affected remaining work rather than rewriting history. A replacement records `supersedes: <old-id>`; superseded contracts remain as history but are not executable.

Before `project.toon.status` becomes `ready`, Planner must render a rich plan brief containing architecture/dataflow, plan graph, invariants, validation strategy, risks, and intentionally untouched areas. Explicit human approval is required.

## Build

`/dev-build` is deterministic extension code, not an orchestrator model.

For each dependency-ready approved `Pxxx` or `Rxxx` contract:

1. persist `current` in `progress.toon`;
2. start a fresh isolated Builder child with the configured exact model/reasoning level;
3. stream its tool activity/output/usage visibly into the parent Pi TUI;
4. Builder may delegate narrow read-only research to `explore`;
5. require exactly one new coherent commit with trailer `Plan-ID: <id>`;
6. independently rerun Planner/Reviewer-declared checks;
7. require a clean worktree;
8. advance `progress.toon` and continue.

A plan gets at most two bounded Builder attempts; the retry may use a stronger configured model. Work is preserved. If the execution contract itself is materially wrong, Builder ends with `NEEDS_REPLAN`; `/dev-build` stops and the human invokes `/dev-plan`. It never summons Planner or Reviewer itself.

## Prepare

`/dev-prepare` creates the remote review candidate and then stops:

1. ensure approved work is complete and the worktree clean;
2. fetch/rebase onto current base;
3. run local integrated/final tests, docs checks, lint and format;
4. stop on semantic conflict or behavior-changing work;
5. push branch;
6. create/update a **draft** PR so CI and review bots run;
7. STOP.

It never waits/polls for CI or bot completion and never launches Review. The human decides when the signals are complete.

## Review and repair planning

The human invokes `/dev-review` after CI and relevant review bots are terminal for the current PR/HEAD. CI may be GREEN **or RED**. Red results are evidence.

Reviewer verifies the external-signal gate, then uses the approved spec, plans/repairs, final diff/history, local evidence, completed CI results/log snippets, bot feedback, PR feedback, tests, and relevant external references. It should fan out several focused Explorers in parallel before synthesizing.

Review does not edit product code. It renders a rich project review. If clean, human approval records `review.toon.status: pass` bound to exact HEAD.

If material repairs are needed, Reviewer creates a draft set of very narrow repair proposals and shows them in the rich review UI. The human can inspect, deselect/filter, or provide feedback and have the Reviewer revise them. Only selected explicitly approved repairs become new immutable `repairs/RNNN.toon` files. Reviewer records `review.toon.status: repairs_approved` and stops. The human decides when to run `/dev-build`.

After repairs, `/dev-prepare` creates a new candidate, external signals run again, and the human invokes `/dev-review` again. There is no hidden repair loop.

## Ship

`/dev-ship` is specific to the final GitHub handoff. It requires `review.toon.status: pass` for exact current HEAD and the same reviewed CI/bot candidate. If HEAD moved, stop.

Shipper updates the PR title/body with a concise high-level human review surface and marks the draft PR ready. Useful sections are:

- Intent
- What changed
- Architecture / API impact (only when material)
- Validation, including CI outcome
- Risks / review focus
- compact Plan -> commit map when useful

Do not dump implementation trivia, logs, or agent prose. Shipper never implements fixes and never merges.

If later human PR feedback requires code, the human invokes `/dev-review` again. Reviewer turns the new evidence into a narrow human-approved repair set; then the same Build -> Prepare -> external signals -> Review cycle repeats.

## Models

`~/.pi/agent/dev-workflow.json` is the only role/model policy. Defaults:

```text
Specifier      gpt-5.6-sol   medium
Planner        gpt-5.6-sol   high
Builder        gpt-5.6-sol   low
Builder retry  gpt-5.6-sol   medium
Explorer       gpt-5.6-luna  medium
Prepare        gpt-5.6-luna  medium
Reviewer       gpt-6-astra   low
Shipper        gpt-5.6-luna  medium
```

The extension sets the configured model/reasoning level explicitly. Missing/ambiguous/unavailable models fail visibly; there is no silent model fallback. Change this matrix freely as models/costs evolve without changing workflow semantics.

## Extension boundary

The Pi extension is allowed to own only harness-level concerns:

- rich fullscreen review UI;
- exact role/model selection;
- visible isolated Builder sessions;
- parallel read-only Explorer sessions;
- minimal `progress.toon` bookkeeping and deterministic build verification.

Planning, implementation judgment, adversarial review, and shipping semantics remain in small skills. If a future feature does not clearly belong to those harness concerns, prove the need before adding custom code.
