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
| Human | Explicit queued request and native presentation/choices; feedback returns to Reviewer, never silently PASS. Approval binds exact HEAD and evidence. |
| Finalize | Luna-medium prose worker only; code updates title/body/readiness after revalidation. Never merges. |

An infrastructure/authentication failure preserves work and stops; it is not a reason to switch providers or escalate to another model. Rebase failure preserves the in-progress rebase. A final integration failure becomes one narrow repair during Ship, or precise failure evidence during standalone Prepare. Repair rounds and recurring stable root-cause keys bound automatic convergence.

## Small durable state

Ignored `plans/<project>/` retains `spec.md`, `project.toon`, immutable `plans/Pxxx.toon` and `repairs/Rxxx.toon`, `progress.toon`, `ship.toon`, and `review.toon`. Updates are atomic. No database or second workflow state machine is added.

Progress binds accepted work to Git HEAD. Shipping persists phase, candidate, local verification, repair count, exact approved HEAD, bounded pending repairs, and blocked reason/resume phase. Pending repair publication is replayable; stale candidate/base/evidence cannot reuse approval. Legacy state lacking an evidence fingerprint is re-reviewed rather than blindly trusted.

AgentHub evidence is separate from workflow authority. Interactive workers retain Pi-native session JSONL files under the parent's session storage, with native custom entries for worker references, delivery receipts, and drafts. These records support inspection/recovery, not scheduling or approval. Model-context compaction does not delete the original transcript. Historical workers reopen read-only; unfinished historical attempts are marked interrupted. Recent controller command/output records are available for inspecting the current run, not a substitute for Git/TOON verification.

## Human interaction

`Alt+A` and `/dev-workers` open one session-wide hub. Normal Main conversations, Spec/Plan Explorers, and controller workers share navigation. `F1` teaches the keys and `F2` exposes owner-provided actions. Each recipient owns its draft and scroll position. Opening, inspecting, or closing a thread never starts, cancels, or resumes execution.

Sending queues a message at the native Pi delivery boundary; it does not interrupt an executing command. A receipt distinguishes queued, delivered, cancelled, and undelivered text. Delivered means present in agent context, not compliance. An undelivered intervention or a structured result that predates required human feedback cannot silently advance the workflow.

Pending questions/approvals are presented only after explicit selection through `F2` or `/dev-attention`. Merely opening a worker or typing in another thread cannot answer them. Cancelling a multiline response preserves unsent text in Main's draft without sending it.

Pause belongs to the controller: `/dev-pause` requests a safe boundary and `/dev-continue` revalidates the paused worktree and approved artifacts before releasing it. Stop requests cancellation and preserves existing changes; it never promises rollback. Manual edits or changed semantics require reconciliation through the existing workflow. Main stays available for discussion and read-only exploration while the controller owns writes.

Worker completion and controller acceptance are distinct outcomes. Accepted Builder attempts remain frozen. A requested follow-up to a completed attempt starts a new read-only Explorer; it never replaces the result already consumed by its parent.

## Scope and integration

`pi/roles.json` is the single role policy. Original global preferences remain at user scope; reusable semantics live in six skills. Skills use Pi's native progressive disclosure: name/description metadata is discoverable before the body is loaded. Bare role sessions do not preload phase skill bodies, and a fresh worker discovers only its assigned skill before invoking it. Internal conflict/finalizer prompts contain only their narrow invocation contracts. `AGENTS.md` defines instruction ownership; this file documents behavior rather than supplying a second agent policy.

Native SDK workers have their own context and cancellation. Every child created through the shared worker boundary registers in AgentHub, whether created by a deterministic `/dev-*` controller or `explore` in the ordinary main conversation. The hub invokes supplied controls but never owns scheduling, Git, verification, workflow state, or model policy. Other extension-owned agents can explicitly register via the `dev:agent-hub` producer seam; the hub does not discover unrelated sessions automatically.

The only general delegation primitive exposed by this package is `explore`: read-only, bounded output, no shell or recursive delegation. Independent evidence-gathering scopes may run in parallel and return compact findings. Workers do not inherit the foreground conversation. Implementation workers load LSP/browser capabilities; web research is confined to Explorer. VCC is explicitly loaded in children with its registered recall tools. Foreground-only PR/usage UI and MCP configurations are not replicated into children.

Pi and the requested plugins own rendering and integrations. AgentHub reuses native editors, message components, and tool rendering, with full raw evidence as a fallback. `pi-github-pr` displays status; the controller still reads exact GitHub evidence through `gh`. The installer does not ship MCP servers, browser-cookie opt-ins, permission bypasses, or user credential files.
