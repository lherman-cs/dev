# Completion guard

`/dev-build`, `/dev-ship`, and their `/skill:dev-*` equivalents activate the same session-native completion guard. The original skill request and subsequent user clarifications remain the scope of work. The installed todo tool supplies the checklist; its tool-result snapshots are read from the active session branch. Unrelated pre-existing tasks are not part of a newly guarded request.

The foreground agent can call `finish` with `outcome: complete` or `blocked`, a short summary and evidence references. This is a proposal. A fresh read-only Pi child with the `assessor` role defined in `roles.json` checks both claims against the original request and current evidence, then delivers a separate result. The child does not authorize writes or replace skill-specific review and human gates. A final answer without `finish` continues at `agent_before_settle` unless an asynchronous result is already on its way. A provisional final may be visible before the result arrives.

Cancellation and session navigation invalidate pending results. Branch-native guard entries survive compaction and restore as interrupted; a saved verdict does not certify a restarted process. Repeated no-progress endings or unavailable assessment produce an explicit incomplete pause instead of success. A new explicit skill invocation starts a new guarded request.
