# Pi-first development workflow

Pi is the harness. Code owns lifecycle transitions, Git/GitHub sequencing, polling, retries, and independent verification. Models own bounded engineering judgment. The human owns worktrees and unresolved semantics. Git is implementation truth, the approved spec is semantic truth, and GitHub is remote-candidate truth.

## Entry points

`dev a <phase>` selects the configured model/thinking and opens Pi without a user turn. Adding a prompt submits `/dev-<phase> <prompt>` immediately. Spec and Plan are native current-session skill aliases. Build, Prepare, Review, and Ship use deterministic code. Resume keeps Pi's saved session model.

Three normal human gates remain: approve semantics, approve architecture/contracts, then approve the exact final candidate. Standalone Build/Prepare/Review remain available. The normal approved-plan path is Ship.

## Boundaries

| Phase | Responsibility and stopping point |
| --- | --- |
| Spec | Challenge semantics/scope/splits, present a compact Markdown/diagram review with structured choices, persist approval, then stop. |
| Plan | Compile independent immutable contracts, show architecture/dataflow/outcome/proof/risk, obtain approval, then stop. |
| Build | Fresh native Pi Implementer per dependency-ready contract; one coherent Conventional Commit, independent checks, clean worktree; at most one implementation retry. |
| Prepare | Code fetches/rebases, delegates only conflicted files when needed, runs final gates before push, creates/updates an exact draft PR, then stops. |
| Await | Code polls terminal CI/reviews and a 60-second quiet period. No model is running. |
| Review | Fresh read-only Reviewer gets approved artifacts, diff/history, local validation, terminal CI, focused failures and PR/bot threads. Concrete material repairs or semantic BLOCKED only. |
| Human | Native Markdown presentation and choices; feedback returns to Reviewer, never silently PASS. Approval binds exact HEAD and evidence. |
| Finalize | Luna-medium prose worker only; code updates title/body/readiness after revalidation. Never merges. |

An infrastructure/authentication failure preserves work and stops; it is not a reason to switch providers or escalate to another model. Rebase failure preserves the in-progress rebase. A final integration failure becomes one narrow repair during Ship, or precise failure evidence during standalone Prepare. Repair rounds and recurring stable root-cause keys bound automatic convergence.

## Small durable state

Ignored `plans/<project>/` retains `spec.md`, `project.toon`, immutable `plans/Pxxx.toon` and `repairs/Rxxx.toon`, `progress.toon`, `ship.toon`, and `review.toon`. Updates are atomic. No database, raw CI log store, model transcript store, or generic event log is added.

Progress binds accepted work to Git HEAD. Shipping persists phase, candidate, local verification, repair count, exact approved HEAD, bounded pending repairs, and blocked reason/resume phase. Pending repair publication is replayable; stale candidate/base/evidence cannot reuse approval. Legacy state lacking an evidence fingerprint is re-reviewed rather than blindly trusted.

## Scope and integration

`pi/roles.json` is the single role policy. Original global preferences remain at user scope; reusable semantics live in six skills. Skills use Pi's native progressive disclosure: only name/description metadata is resident until an explicit `/skill:...` invocation loads the body. Bare role sessions do not preload phase skill bodies, and a fresh worker discovers only its assigned skill before invoking it. Internal conflict/finalizer prompts contain only their narrow invocation contracts. `AGENTS.md` defines instruction ownership; this file documents behavior rather than supplying a second agent policy.

Native SDK workers are in-memory sessions, with their own context and cancellation. Every child created through the shared worker boundary registers in one session-wide Agent Hub, whether it came from a deterministic `/dev-*` controller or from `explore` in the ordinary main conversation. `Alt+A` opens the live roster/inspector/thread UI; the Hub may steer, follow up, or abort the supplied session but never owns scheduling, Git, verification, workflow state, or model policy. The only exposed delegation primitive is `explore`: read-only, bounded output, no shell or recursion. Every open-ended or input-heavy codebase investigation, web search, or other evidence-gathering scope is delegated separately; independent scopes may run in parallel and return compact findings. Workers do not inherit the foreground conversation. Implementation workers load LSP/browser capabilities, while web research is available only inside Explorer; foreground-only PR/usage UI and MCP configurations are not replicated into children.

Pi and the requested plugins own rendering and integrations. `pi-github-pr` displays status; the controller still reads exact GitHub evidence through `gh`. The installer does not ship MCP servers, browser-cookie opt-ins, permission bypasses, or user credential files.
