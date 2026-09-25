# Pi-first development workflow

Pi is the harness. The request, repository evidence, applicable approved decisions, Git state, and local validation define the work. The foreground agent owns its worktree. Supporting workers provide evidence, not authority. The human owns remote publishing and final integration.

## Public phases

`dev a <phase>` supports exactly `spec`, `build`, `review`, and `ship`. A prompt invokes the matching `/dev-<phase>` skill in the current conversation.

| Stage | Responsibility |
| --- | --- |
| Spec | Converge the smallest coherent outcome the human actually wants. Resolve consequential semantics and scope with explicit human approval. |
| Build | Implement the approved outcome, validate it, and commit locally. Resolve ordinary engineering choices autonomously. |
| Review | Merge the current local integration branch, normally `main`, into the candidate; resolve conflicts; deeply review and repair the integrated result; keep the CTO's high-level system model current; involve the human only for consequential behavior, architecture, scope, or risk decisions. |
| Ship | Package the reviewed tree into a clean local `ship/<name>` branch with a minimal linear commit history. Do not change candidate content. |

Spec, Build, and Review activate a session-native goal. Spec and Review are collaborative goals: ordinary human conversation keeps the same goal active. Ship does not activate a goal.

No phase automatically transitions to another phase.

## Spec and Review web workspace

Spec and Review use one local, session-scoped webpage for human interaction. Entering either phase opens the page and shows a local URL; `/dev-spec-view` or Alt+S and `/dev-review-view` or Alt+R reopen it. The page follows a pull-request review flow: Conversation for contextual comments, Changes for the current artifact and inspected revisions, Checks for approval gates, and Submit review for a comment, a change request, or explicit revision-bound approval. A change request blocks approval until a new revision is published and applied. The agent edits `plans/<project>/spec.md` and publishes its semantic content for Spec; Review publishes a candidate-bound engineering assessment. No terminal approval fallback is provided. Outside these phases, structured human questions still use `ask_user_question`.

The service listens only on loopback and rejects cross-origin writes. Browser content is untrusted text, never executable markup. Reloading or closing the tab does not stop work or grant approval. Restarted state retains discussions and drafts but revokes approval and requires agent reconciliation. New versions await inspection and application without replacing the displayed revision. Goal activation, pause, resume, and abandonment remain separate Pi controls. Neither approval starts the next phase. The checked-in `pi/web/dist` serves immediately; after changing the web source, run `npm --prefix pi/web ci && npm --prefix pi/web run build` to refresh it.

## Review contract

Review is a foreground engineering phase, not a Reviewer sub-agent handoff.

At entry, Review reconstructs the approved outcome and candidate from observable repository state, then merges the current local integration branch into the candidate. Merge commits are acceptable in development history because that history is not the shipping artifact. Review evaluates the integrated candidate, repairs ordinary in-scope defects, and reruns validation invalidated by the merge or repairs.

Review's human interaction is CTO-facing in the local webpage. `/dev-review-view` or Alt+R reopens it during an active Review goal. Outcome, evidence, architecture, risks, recommendation, consequential decisions, and subject-bound discussion appear together, with general discussion available separately. The agent publishes structured assessments and answers review requests in place; a changed assessment stays pending until the human previews and applies it. Closing the workspace never means approval. Drafts and context survive reopening, while uncertain queued requests are not replayed on restoration. A dirty or changed candidate, new local integration baseline, pending assessment, or restored un-reconciled state blocks current-candidate approval. The human explicitly resolves decisions and approves the clean, assessed candidate inside the workspace before Review can complete. Historical approvals do not authorize later candidates. This approval is not a release, push, merge, or Ship request. The agent explains the relevant system model and evidence without making the human adjudicate routine repairs.

The Review endpoint is a technically converged candidate against the merged integration baseline, with applicable passing validation and material concerns resolved or explicitly understood with the human. Review does not rewrite history, push, deploy, or merge the candidate into another branch.

## Ship contract

Ship is a guarded packaging operation, not a general-purpose foreground engineering phase.

The source development candidate must already be clean, fully committed, and converged by Review. The runtime mechanically captures its exact tree and requires the current local `main` to equal the candidate's merge-base with `main`; if `main` advanced after Review, shipping stops and the candidate returns to Review.

Before any Ship model runs, the runtime creates a disposable standalone Git repository containing only the reviewed baseline and reviewed candidate content. It has no remotes and no source-worktree reference. The model is never given the source repository path or source branch. It receives read-only inspection tools plus one `ship_commit` primitive that can commit existing changed paths but cannot author file content.

The model's only judgment is commit grouping and Conventional Commit wording. Prefer one commit unless separating changes materially improves coherence or independent shippability. It does not merge, repair, validate, explore, edit files, or make product decisions.

After the isolated model workspace is clean, the runtime compares its final tree hash with the captured reviewed candidate tree. Only then does the host create a real local `ship/<name>` worktree from the exact reviewed `main` baseline and replay the isolated commits. The host then mechanically verifies:

- the source development branch still points to the same reviewed candidate;
- the final shipping tree exactly equals the reviewed candidate tree;
- the base-to-candidate diff is identical;
- every shipping commit has one parent, so history is linear;
- the final worktree is clean.

Any mismatch deletes the provisional shipping branch/worktree and leaves the source branch untouched. A successful run removes its temporary workspaces and leaves only the verified local `ship/<name>` branch.

Ship does not fetch, push, deploy, open or mutate remote review state, or merge into another branch.

## Supporting evidence

`explore` is the bounded read-only investigation primitive. Use it for material research or repository investigation that would otherwise consume substantial foreground context. Explorers do not edit, verify, make project decisions, or delegate.

`verify` runs tests, builds, lints, benchmarks, and acceptance checks against the owner's actual worktree and returns asynchronous evidence tied to that candidate. Keep a candidate unchanged while a relevant verification run is active.

Agent Hub is an inspection and owner-action UI for child sessions, not a scheduler or workflow authority. Child results are evidence only.

## Recovery and ownership

Every phase reconstructs work from the request, applicable decisions, and live Git/worktree evidence. A prior session, plan, or status marker is never required to begin and never substitutes for observable state.

The active foreground agent owns its worktree exclusively. Existing tracked and untracked work is classified by content before staging or removal. Irrelevant edits may be backed up and removed under the shared reconciliation policy; ignored files and independent remote work remain outside that authority.

Consequential unresolved intent, scope, semantics, or authority goes to the human. Ordinary engineering failures are diagnosed and repaired autonomously.
