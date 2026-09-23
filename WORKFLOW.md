# Pi-first development workflow

Pi is the harness. The request, repository evidence and any applicable approved artifacts define semantics; Git is implementation truth and GitHub is remote-candidate truth. The agent owns its independent worktree through completion. Optional read-only workers provide evidence, not ownership or a mandatory handoff. `/dev-ship` never merges.

## Entry points

`dev pi <args...>` passes arguments to the pinned project-local Pi runtime. `dev a <phase>` selects the configured model and thinking level, then opens Pi without a user turn. Adding a prompt submits `/dev-<phase> <prompt>` immediately. The public phase set is exactly `spec`, `plan`, `build`, and `ship`; every alias loads the corresponding explicit lazy skill in the current conversation. Pi can resume saved sessions, but a fresh agent can also reconstruct work from live evidence.

A prior spec, plan, or phase is not required: planning and building can derive semantics from a sufficiently defined request and repository. Applicable approved decisions remain binding, but a status marker alone does not establish approval. The owner asks only about consequential unresolved product semantics, scope, ownership or authority. Readiness approval is required only when the request or applicable policy reserves it to a human; merging belongs to a separate workflow.

## Phase boundaries

| Phase | Responsibility and stopping point |
| --- | --- |
| Spec | Make semantics decision-complete from the request and evidence. Seek approval only if explicitly requested. |
| Plan | Design independently testable outcomes from the request and any applicable spec. Seek approval only if explicitly requested. |
| Build | Complete required outcomes incrementally, following applicable approved decisions. Validate and commit coherent outcomes; resolve ordinary implementation and test failures. |
| Ship | Own preparation, repair, publication, CI inspection and readiness from live evidence. Optional Reviewer findings are evidence. Seek human confirmation when required by authority; never merge in dev-ship. |

## Isolated child sessions

`explore` is the general bounded investigation and verification primitive. Parent agents use it for read-only evidence gathering reasonably expected to take material time or produce substantial raw output, including broad repository or web research and slow or noisy targeted verification. Quick known-target reads and small low-output checks may stay direct. Every call creates a fresh asynchronous Explorer with a narrowly scoped factual question or command, explicit boundaries, and compact schema-checked evidence. Explorer may run targeted tests, builds, lints, benchmarks, CI/check inspection, and log analysis, but has no edit/write, browser-control, or recursive delegation capability and must not make project decisions. Mutation, interaction, privileged integrations, and final interpretation remain with the parent. All callers, including workers, receive an immediate receipt and continue from the separately delivered completion rather than awaiting the Explorer call.

`review` is an optional asynchronous read-only primitive available only to the active Shipper after an explicit `dev-ship` invocation:

```text
review({ task, candidate, evidence })
```

It creates a fresh Reviewer that explicitly loads `dev-review`. The Shipper receives a job receipt immediately, so independent Explorers and Reviewers can run concurrently while it continues useful work. Each completion is injected when it settles. No caller awaits a child agent. Missing or late delivery does not block the owner from inspecting live evidence and continuing.

Reviewer has repository read tools, VCC recall, bounded Explorer access, and `submit_result`, but no mutation, shell, PR, direct-human, or recursive-review capability. Its response is bounded, uses `PASS`, `REPAIRS`, or `BLOCKED`, and exactly echoes the supplied candidate and evidence. Transport validation does not prove evidence completeness or prevent candidate drift: the active Shipper rechecks both before any repair or human confirmation.

Native SDK read-only workers have independent HEAD-snapshot worktrees, isolated contexts and cancellation, with Pi-native persisted child transcripts when the parent has a session file. The owner handles uncommitted edits locally unless it explicitly provides read-only evidence. Every child created through the shared worker boundary registers in one session-wide Agent Hub. `Alt+A` opens the live roster, inspector, and thread UI; the Hub may steer or stop a supplied session but never owns phase sequencing, Git, verification, workflow state, or model policy.

Runtime allowlists enforce isolation, edit/write-tool denial, web-tool exclusivity, and non-recursion. The Explorer tool contract owns the general material-cost delegation trigger; the Explorer skill constrains its shell to targeted verification rather than source mutation. Whether a local operation will be materially costly and whether natural-language scopes overlap remain semantic parent responsibilities, made reviewable through explicit boundaries and exclusions rather than misrepresented as mechanically provable. Workers do not inherit the foreground conversation. Web research is available only inside Explorer; foreground-only PR/usage UI and MCP configurations are not replicated into children.

## Human supervision and recovery

Agent Hub is a view and owner-action adapter, not a scheduler. The foreground Shipper sequences live observations, Git/GitHub actions and human approval. The Hub preserves independent drafts, anchored history navigation, contextual help, native messages, tool rendering, and completed child transcripts. A queued instruction is not delivered until accepted. The worker owner seals completed sessions and rejects stale structured results after interventions. Related questions create a fresh bounded investigation rather than reviving a completed result.

Read-only workers never acquire ownership of the worktree. On a session change, child cancellation is requested without vetoing or waiting on the owner; late results cannot be delivered into another session. Git, applicable artifacts when present, and remote state make failures visible and resumable. If Explorer is unavailable or fails, the parent may disclose and perform only necessary permitted read-only work directly with bounded output. This fallback grants no prohibited tool or mutation capability, and no fabricated completion is available.

Each invoked phase reconciles from artifacts and live Git/worktree or remote evidence, even for a new agent with no saved session. The exclusive writing owner classifies existing dirty edits, adopts relevant work under approved scope, and may remove irrelevant uncommitted edits after a best-effort local backup with an explicit removal/backup report. Ignored files, committed history and independent remote work are outside that cleanup authority. Missing prior artifacts or sessions do not by themselves require human direction. Consequential unresolved intent, scope, or authority does; nothing relaunches automatically.

Pi and the requested plugins own rendering and integrations. `pi-github-pr` displays status; the active role reads and evaluates exact GitHub evidence as needed. The installer does not ship MCP servers, browser-cookie opt-ins, permission bypasses, or user credential files.

See [Agent Hub](pi/AGENT_HUB.md) for keyboard controls and retention.
