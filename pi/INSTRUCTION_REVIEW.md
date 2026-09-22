# Baseline intention review

Baseline: `94d10a650b3d10198043afa602d4887fbeee34ce`. This is migration evidence, not an agent prompt.

| Intention | Owner / coverage |
| --- | --- |
| Narrow, non-duplicated instructions | Root `AGENTS.md` and focused skills. |
| Human-owned semantic decisions | `dev-spec`, `dev-plan`, `dev-build`, and `dev-ship` skill contracts. |
| No foreground orchestrator | The extension only dispatches current-session skill aliases and provides isolated child tools. |
| Fresh, bounded investigations | Native SDK worker sessions, `explore`, `review`, and Agent Hub tests. |
| No automated merge | `dev-ship` explicitly prepares and presents candidates only. |
| Explicit model ownership | `roles.json` maps every public and internal role to one model. |
