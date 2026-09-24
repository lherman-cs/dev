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

## Review contract

Review is a foreground engineering phase, not a Reviewer sub-agent handoff.

At entry, Review reconstructs the approved outcome and candidate from observable repository state, then merges the current local integration branch into the candidate. Merge commits are acceptable in development history because that history is not the shipping artifact. Review evaluates the integrated candidate, repairs ordinary in-scope defects, and reruns validation invalidated by the merge or repairs.

Review's human interaction is CTO-facing. It progressively explains the relevant architecture, ownership boundaries, invariants, tradeoffs, failure modes, and evidence as those become relevant to the current change. It does not produce a code tour or ask the human to adjudicate routine repairs. Consequential choices are presented with concrete consequences and a recommended direction.

The Review endpoint is a technically converged candidate against the merged integration baseline, with applicable passing validation and material concerns resolved or explicitly understood with the human. Review does not rewrite history, push, deploy, or merge the candidate into another branch.

## Ship contract

Ship changes representation only.

The reviewed candidate tree and reviewed integration baseline are immutable inputs. Ship creates an isolated local `ship/<name>` branch and rebuilds the reviewed change as the smallest useful set of coherent Conventional Commits. Development merge commits and incidental implementation history are not preserved.

The model may decide only semantic commit grouping and commit-message wording. Candidate identity, changed-path accounting, Git operations, and final equivalence are mechanical concerns.

Before completion, Ship must establish:

- the source development branch was not rewritten or otherwise mutated;
- the shipping branch is based on the exact integration baseline reviewed by Review;
- the final shipping tree is identical to the reviewed candidate tree;
- every base-to-candidate change is present exactly once and no unrelated change entered;
- the worktree is clean and the shipping history is linear.

If exact equivalence cannot be established, Ship stops and preserves both branches. If the integration branch has moved beyond the baseline Review merged, the candidate returns to Review rather than being adapted by Ship.

Ship does not fetch, push, deploy, open or mutate remote review state, or merge into another branch.

## Supporting evidence

`explore` is the bounded read-only investigation primitive. Use it for material research or repository investigation that would otherwise consume substantial foreground context. Explorers do not edit, verify, make project decisions, or delegate.

`verify` runs tests, builds, lints, benchmarks, and acceptance checks against the owner's actual worktree and returns asynchronous evidence tied to that candidate. Keep a candidate unchanged while a relevant verification run is active.

Agent Hub is an inspection and owner-action UI for child sessions, not a scheduler or workflow authority. Child results are evidence only.

## Recovery and ownership

Every phase reconstructs work from the request, applicable decisions, and live Git/worktree evidence. A prior session, plan, or status marker is never required to begin and never substitutes for observable state.

The active foreground agent owns its worktree exclusively. Existing tracked and untracked work is classified by content before staging or removal. Irrelevant edits may be backed up and removed under the shared reconciliation policy; ignored files and independent remote work remain outside that authority.

Consequential unresolved intent, scope, semantics, or authority goes to the human. Ordinary engineering failures are diagnosed and repaired autonomously.
