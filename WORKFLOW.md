# Pi-first development workflow

Pi is the harness. The request, repository evidence, applicable approved decisions, Git state, and local validation define the work. The foreground agent owns its worktree. Supporting workers provide evidence, not authority. The human owns remote publishing and final integration.

## Public phases

`dev a <phase>` supports exactly `spec`, `build`, `review`, and `ship`. A prompt invokes the matching `/dev-<phase>` skill in the current conversation.

| Stage | Responsibility |
| --- | --- |
| Spec | Converge the smallest coherent outcome the human actually wants. Resolve consequential semantics and scope with explicit human approval. |
| Build | Implement the approved outcome, validate it, and commit locally. Resolve ordinary engineering choices autonomously. |
| Review | Review the existing candidate diff against agreed intent; repair clear in-scope defects; obtain human approval for all consequential changes, including spec-compliant behavior and major design choices. |
| Ship | Approve a generated commit message and integrate the exact committed candidate tree into local `main` as one squash commit. |

Spec, Build, and Review activate a session-native goal. Spec and Review are collaborative goals: ordinary human conversation keeps the same goal active. Ship does not activate a goal.

No phase automatically transitions to another phase.

## Review contract

Review is a foreground engineering phase, not a Reviewer sub-agent handoff.

At entry, Review establishes the existing diff and applicable agreed specifications and intent from observable repository state, including relevant uncommitted work. It does not require a new spec. Review checks alignment and material correctness, following affected interactions only where needed to understand consequences. Clear in-scope bugs are repaired and validated without permission; ambiguous deviations and discretionary decisions are surfaced before being kept or changed.

The human approves every consequential change, including spec-compliant behavior and major design choices. Review groups related decisions by outcome, states their alignment, effects, evidence, uncertainty, and recommendation, and offers approval, requested changes, or deferral. The reviewer implements and validates requested approved changes; materially changed effects need renewed approval. Deferral leaves a concern unresolved.

Review ends with applicable validation passing, required approvals obtained, and material concerns resolved. It reports scope, approvals, repairs, validation, and remaining concerns. It does not merge, stage, commit, rewrite history, push, or deploy. The human prepares integration and commits before Ship, returning for review if integration materially changes reviewed effects; unchanged content needs no reapproval solely because it was committed.

## Ship contract

Ship is a guarded packaging operation, not a general-purpose foreground engineering phase.

The human must prepare a clean, fully committed candidate with the current local `main` integrated before Ship. The runtime mechanically captures its exact tree and requires `main` to equal the candidate's merge-base with `main`; if it has advanced, shipping stops until the human prepares the candidate and returns for review if integration materially changes it.

Before the message model runs, Ship requires a named clean feature branch, local `main`, no unresolved Git operations, and a safe clean checkout of main if one exists. An identical candidate/main tree is a no-op, even after a previous squash. Otherwise main must be an ancestor of the candidate. No fetch or automatic preparation occurs.

The model proposes only a Conventional Commit title and body from the candidate delta. The human sees the full message and explicitly approves shipping to local main, requests repeated tweaks, or cancels. Tweaks never imply approval. Ship rechecks captured source and main identities and checkout safety after discussion and immediately before integration. Changed state requires a fresh invocation and approval.

A temporary linked worktree constructs the single-parent commit with normal hooks and configured signing. Hook-induced message or tree drift blocks publication. The runtime fast-forwards main, updating its clean checkout when present, and leaves the feature branch untouched. Failures report actual main state for recovery; checkout and ref updates are not promised to be atomic. Ship does not fetch, push, deploy, or open remote review state.

## Supporting evidence

`explore` is the bounded read-only investigation primitive. Use it for material research or repository investigation that would otherwise consume substantial foreground context. Explorers do not edit, verify, make project decisions, or delegate.

`verify` runs tests, builds, lints, benchmarks, and acceptance checks against the owner's actual worktree and returns asynchronous evidence tied to that candidate. Keep a candidate unchanged while a relevant verification run is active.

Agent Hub is an inspection and owner-action UI for child sessions, not a scheduler or workflow authority. Child results are evidence only.

## Recovery and ownership

Every phase reconstructs work from the request, applicable decisions, and live Git/worktree evidence. A prior session, plan, or status marker is never required to begin and never substitutes for observable state.

The active foreground agent owns its worktree exclusively. Existing tracked and untracked work is classified by content before staging or removal. Irrelevant edits may be backed up and removed under the shared reconciliation policy; ignored files and independent remote work remain outside that authority.

Consequential unresolved intent, scope, semantics, or authority goes to the human. Ordinary engineering failures are diagnosed and repaired autonomously.
