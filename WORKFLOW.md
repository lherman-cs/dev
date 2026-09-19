# Pi-first development workflow

## Design

Pi is the harness. TypeScript owns deterministic lifecycle control; fresh LLM workers own engineering judgment. Keep both sides small.

Hard constraints:

- The human creates and manages worktrees.
- No orchestrator agent, database, event log, or durable model transcript.
- Git is implementation truth. The approved spec is semantic truth. GitHub is remote-candidate truth.
- Models never poll, wait, decide workflow phase, or claim their own verification.
- Every expensive model action is narrow and independently checked where practical.
- Shipping is restartable. Durable workflow files are compact TOON state under ignored `plans/<project>/`.

## Human boundaries

There are three normal human decisions:

1. `/dev-spec`: approve intended behavior, invariants, scope, and non-goals.
2. `/dev-plan`: approve architecture and small execution contracts.
3. `/dev-ship`: approve the final exact candidate after automated convergence.

Shipping stops early only when correct behavior is not determined by the approved spec, the repair loop does not converge, or repository/remote reality becomes unsafe to reconcile automatically.

## Lifecycle

```text
human creates worktree
        |
     /dev-spec
        |  rich brief + approval
     /dev-plan
        |  small immutable plans + rich brief + approval
     /dev-ship
        |
        |  BUILD
        |    fresh Builder per pending plan/repair
        |    deterministic commit/check verification
        |
        |  PREPARE
        |    fetch + rebase
        |    LLM resolves conflicts only when Git needs judgment
        |    repository final checks
        |    push/update draft PR
        |
        |  AWAIT
        |    exact-HEAD GitHub polling only
        |    no model is alive
        |
        |  REVIEW
        |    one fresh adversarial Reviewer over complete evidence
        |        |
        |        +-- repairs --> BUILD
        |        +-- semantic ambiguity/non-convergence --> BLOCKED
        |        `-- pass --> HUMAN
        |
        |  HUMAN
        |    rich final exact-candidate review
        |        |
        |        +-- feedback --> REVIEW/BUILD
        |        `-- approve --> finalize PR + mark ready
        |
        `-- DONE
```

`/dev-build`, `/dev-prepare`, and `/dev-review` remain lower-level commands for debugging or manual use. The normal post-plan path is `/dev-ship`.

## Minimal durable state

All workflow artifacts are ignored under `plans/<project>/`:

```text
spec.md
project.toon
progress.toon
ship.toon
plans/P001.toon
plans/P002.toon
repairs/R001.toon
review.toon
```

`progress.toon` owns only Builder progress: completed IDs, current ID, and accepted HEAD.

`ship.toon` owns only shipping control:

- phase: `build | prepare | await | review | human | blocked | done`
- bounded repair round
- exact HEAD that passed local final gates
- exact published candidate identity
- exact HEAD approved by the human
- last deterministic final-gate failure for recurrence detection
- blocked reason and resume phase

Do not store CI logs, bot transcripts, source copies, model transcripts, or generic event history.

TOON updates are atomic. Operations with external side effects are reconciled before advancing state, so interruption may repeat cheap work but must not destroy or duplicate meaningful work.

## Build

`/dev-build` remains deterministic extension code.

For each dependency-ready approved `Pxxx` or `Rxxx`:

1. persist the current work ID;
2. launch one fresh `dev-implement` worker for the exact contract;
3. require exactly one Conventional Commit from the accepted predecessor, with no workflow IDs in its message;
4. independently rerun declared checks;
5. require a clean worktree;
6. advance progress.

A work item gets at most two Builder attempts. Interrupted sessions preserve work and do not justify destructive Git recovery.

## Prepare

The shipping controller performs preparation directly:

1. require a clean worktree;
2. fetch the configured base, defaulting to `origin/main`;
3. rebase;
4. when Git reports conflicts, launch one fresh conflict resolver constrained to the conflicted files and approved spec, then let deterministic code stage and continue the rebase;
5. run `project.toon.final_checks`, or fall back to root `just check` and `just test`;
6. if a final gate fails, create one narrow repair contract from the exact failure and loop to Build;
7. push with `--force-with-lease`;
8. create or update a draft PR and bind the candidate to exact HEAD/base.

A repeated identical final-gate failure blocks instead of blindly generating another repair.

Standalone `/dev-prepare` remains available and stops after publishing.

## Await

Awaiting external evidence is traditional tooling only.

The controller polls `gh` for the exact PR HEAD. It waits until checks are terminal, then requires a short quiet period with no PR/check changes so late review-bot feedback can land. No model tokens are consumed while waiting.

If the PR HEAD moves unexpectedly, shipping blocks rather than reviewing stale evidence.

## Review and automatic repair

The autonomous Reviewer receives the approved spec, plans, prior repairs, exact candidate diff/history, local validation, terminal CI, and settled PR/bot feedback. CI may be red or green; terminal red is evidence.

It produces one of:

- `pass`: candidate can enter final human review.
- `repairs_planned`: all material implementation repairs are written as one narrow immutable repair batch.
- `blocked`: correct resolution needs a semantic decision or the same previously repaired finding recurred.

Review repairs carry a stable `source.finding_key`. If that root finding recurs after repair, do not spend another automatic cycle on it.

The controller allows at most two automatic repair rounds by default. This is a convergence guard, not a quality target.

Standalone `/dev-review` keeps the richer human-filtered repair workflow.

## Final human review

Machine pass is not final approval.

The controller renders the existing rich Pi review surface for the exact candidate, including summary, review focus, validation, and repair-round count.

Human feedback is sent through the same semantic Reviewer. It must produce repairs or block for a semantic decision; it may not silently pass.

Human approval is persisted against exact HEAD before finalization so an interruption does not require another approval. A fresh finalizer updates the concise PR title/body and marks the draft ready. It never merges.

## Skill boundary

Skills stay tiny, reusable, and single-purpose: Spec, Plan, Implement, manual Prepare, and Review. They never contain runtime modes or route to other skills.

`/dev-build` dispatches `dev-implement` and owns retries/progress/independent verification. `/dev-ship` owns deterministic convergence. Its machine Reviewer reuses `dev-review` semantics with only a structured-output contract; conflict resolver and PR finalizer are narrow internal roles.

## Human review UX

Spec, Plan, and final Review use `workflow_brief`, a reusable Pi TUI surface that should feel closer to a modern web review page than a traditional terminal prompt, with Markdown, diagrams, code/data views, optional images, mouse/keyboard navigation, and feedback.

Spend model tokens on understanding and concise communication, not presentation boilerplate.

## Explorer

`explore` is a fresh, narrow, read-only subagent primitive. Use it when focused parallel research reduces parent context or improves confidence.

Good tasks include repository invariants, diff impact, CI failure diagnosis, PR feedback verification, tests, and primary external references. Parents receive compact `Conclusion / Evidence / Uncertainty` results rather than transcripts.

## Models

`~/.pi/agent/dev-workflow.json` is the only role/model policy. Missing or ambiguous models fail visibly; there is no silent fallback. Model choice is configuration, not workflow semantics.
