# Pi-first development workflow

Pi is the harness. Git is implementation truth, the approved spec and plan are semantic truth, and GitHub is remote-candidate truth. `/dev-ship` is coordinated by the foreground agent from live evidence, with asynchronous Builder and Reviewer workers and explicit human readiness approval. It has no merge authority.

## Entry points

`dev pi <args...>` passes arguments to the pinned project-local Pi runtime. `dev a <phase>` selects the configured model and thinking level, then opens Pi without a user turn. Adding a prompt submits `/dev-<phase> <prompt>` immediately. The public phase set is exactly `spec`, `plan`, `build`, and `ship`; every alias loads the corresponding explicit lazy skill in the current conversation. Resume uses Pi's saved session model.

Three human gates remain: approve semantics, approve architecture and contracts, then approve the exact final candidate. The active Shipper never merges. It prepares and presents a candidate only after its own remote inspection, checks, review evidence, and explicit human confirmation.

## Phase boundaries

| Phase | Responsibility and stopping point |
| --- | --- |
| Spec | Challenge semantics, scope, splits, callers, ownership, failures, and acceptance evidence. Present the review and stop after explicit approval. |
| Plan | Turn the approved spec into independently testable outcomes with architecture, dataflow, proof, risks, and deletion choices. Stop after approval. |
| Build | Complete approved outcomes incrementally. Validate and independently commit each coherent outcome. Resolve ordinary implementation and test failures; stop only for an unresolved consequential decision. |
| Ship | Inspect the approved scope, Git and GitHub; coordinate Builder preparation and independent Reviewer audit, revalidate live evidence, and present a final packet for explicit human approval. Never merge. |

## Isolated child sessions

`explore` is the general bounded investigation and verification primitive. Parent agents use it for read-only evidence gathering reasonably expected to take material time or produce substantial raw output, including broad repository or web research and slow or noisy targeted verification. Quick known-target reads and small low-output checks may stay direct. Every call creates a fresh asynchronous Explorer with a narrowly scoped factual question or command, explicit boundaries, and compact schema-checked evidence. Explorer may run targeted tests, builds, lints, benchmarks, CI/check inspection, and log analysis, but has no edit/write, browser-control, or recursive delegation capability and must not make project decisions. Mutation, interaction, privileged integrations, and final interpretation remain with the parent. All callers, including workers, receive an immediate receipt and continue from the separately delivered completion rather than awaiting the Explorer call.

`review` is an asynchronous read-only primitive available only to the active Shipper after an explicit `dev-ship` invocation:

```text
review({ task, candidate, evidence })
```

It creates a fresh Reviewer that explicitly loads `dev-review`. The Shipper receives a job receipt immediately, so independent Explorers and Reviewers can run concurrently while it continues useful work. Each completion is injected as soon as it settles and triggers its owning caller again if idle. No caller awaits a child agent. This includes Main tools, worker-owned Explorers, and ship Builder and Reviewer calls. Callers should stop only when a pending result truly gates further progress.

Reviewer has repository read tools, VCC recall, bounded Explorer access, and `submit_result`, but no mutation, shell, Git, PR, direct-human, or recursive-review capability. Its response is bounded, uses `PASS`, `REPAIRS`, or `BLOCKED`, and exactly echoes the supplied candidate and evidence. Transport validation does not prove evidence completeness or prevent candidate drift: the active Shipper rechecks both before any repair or human confirmation.

Native SDK workers have isolated contexts and cancellation, with Pi-native persisted child transcripts when the parent has a session file. Ship Builder returns a receipt immediately, and its bounded exact-candidate result arrives separately. Every child created through the shared worker boundary registers in one session-wide Agent Hub. `Alt+A` opens the live roster, inspector, and thread UI; the Hub may steer or stop a supplied session but never owns phase sequencing, Git, verification, workflow state, or model policy.

Runtime allowlists enforce isolation, edit/write-tool denial, web-tool exclusivity, and non-recursion. The Explorer tool contract owns the general material-cost delegation trigger; the Explorer skill constrains its shell to targeted verification rather than source mutation. Whether a local operation will be materially costly and whether natural-language scopes overlap remain semantic parent responsibilities, made reviewable through explicit boundaries and exclusions rather than misrepresented as mechanically provable. Workers do not inherit the foreground conversation. Web research is available only inside Explorer; foreground-only PR/usage UI and MCP configurations are not replicated into children.

## Human supervision and recovery

Agent Hub is a view and owner-action adapter, not a scheduler. The foreground Shipper sequences live observations, Git/GitHub actions and human approval. The Hub preserves independent drafts, anchored history navigation, contextual help, native messages, tool rendering, and completed child transcripts. A queued instruction is not delivered until accepted. The worker owner seals completed sessions and rejects stale structured results after interventions. Related questions create a fresh bounded investigation rather than reviving a completed result.

The active conversation is responsible for deciding whether to stop a child before changing the worktree. Git, approved artifacts, and remote state make failures visible and resumable. If Explorer is unavailable or fails, the parent may disclose and perform only necessary permitted read-only work directly with bounded output. This fallback grants no prohibited tool or mutation capability, and no fabricated completion is available.

Pi and the requested plugins own rendering and integrations. `pi-github-pr` displays status; the active role reads and evaluates exact GitHub evidence as needed. The installer does not ship MCP servers, browser-cookie opt-ins, permission bypasses, or user credential files.

See [Agent Hub](pi/AGENT_HUB.md) for keyboard controls, retention, and the minimal external-session adapter.
