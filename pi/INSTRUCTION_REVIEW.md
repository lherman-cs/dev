# Baseline intention review

Baseline: `94d10a650b3d10198043afa602d4887fbeee34ce`. This is migration evidence, not an additional agent prompt.

| Original intention | Final owner / regression coverage |
| --- | --- |
| No duplicate/contradictory instructions; least scope; do not teach defaults | Root `AGENTS.md` retains the original invariants and source ownership rules. |
| User preferences remain user-wide | `preferences.md` seeds a missing Pi `AGENTS.md` only. Existing instructions/settings/auth are preserved. |
| Spec is semantic, split decisions are human-owned, stop after approval | Restored `dev-spec`; structured Markdown/choices replace only the retired renderer. |
| Plan is independently testable, immutable after dispatch, replan is not debugging | Restored `dev-plan`; no progress edits or research transcript duplication. |
| Implement one contract/commit; retry amends; no controller Git operations | Restored `dev-implement`; real-Git commit/check/recovery tests. |
| No foreground orchestrator; fresh workers; universal narrow Explorer | Native SDK sessions, one `explore` tool, no arbitrary subagent framework. Native-session isolation/cancellation tests. |
| Preparation mechanics belong to code; conflict resolver only when necessary | `ship.mjs` performs fetch/rebase/final gates/push/draft binding. Conflict worker has no shell/Git tool. |
| Final-gate failure produces one bounded repair; recurrence stops | Persistent finding key and two-round cap; tested final-gate repair and recurrence. |
| Await terminal checks and settled review feedback without a model | Traditional `gh` polling with 60-second quiet period and cancellation. Pending/late-feedback tests. |
| Reviewer uses complete candidate evidence, not taste; never edits | Restored skill; code supplies diff/history, checks, focused failures and review threads. Worker gets read tools and Explorer only. |
| Standalone review is human-filtered | Native multi-choice selection writes only selected repair contracts. |
| Shipping restarts without losing exact-HEAD approval or duplicating work | Original `ship.toon` fields plus evidence fingerprint; tested interruption after approval, pending repair batch replay, changed candidate rejection. |
| Human feedback means repairs or a semantic stop, never silent PASS | Persisted feedback goes through the Reviewer; false PASS is rejected. |
| Finalization updates prose/readiness, never merges | Code rechecks candidate/evidence; tests assert no merge call. |
| Small reusable skills, no runtime modes, no semantic duplication in dispatch | Five semantic skills restored; conflict resolver/finalizer contracts stay narrow and internal. |

Authorized changes from the baseline: symmetric CLI launchers, native current-session Spec/Plan aliases, subscription authentication transport, local Git excludes, the six requested plugins, and native/plugin review UI. Neither the old custom TUI nor OMP compatibility code is restored. Legacy checkpoints without the new evidence fingerprint are re-reviewed before finalization; they are not blindly treated as a current machine PASS.
