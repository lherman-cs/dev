# Representative dev-review interaction

This is an interaction target for foreground `dev-review`, not a second approval system.

A candidate changes participant reconnection behavior. Review establishes the candidate diff and agreed intent, including uncommitted changes, without requiring a new spec or merging `main`.

The reviewer finds that delayed cleanup from an old connection can remove state owned by its replacement. This is a clear in-scope bug: the reviewer adds the narrow ownership guard and validates it without asking permission. A formatting-only edit needs no approval or style discussion.

The diff also intentionally changes reconnect grace time and moves reconnect-state ownership from connection to participant. Both may comply with the spec, but the grace time affects user-visible behavior and the ownership move is a major design choice. The reviewer groups related effects while keeping the distinct decisions visible:

> Reconnect now keeps participants for longer during a transport drop, as agreed, but may delay presence cleanup. I recommend approving this behavior; the reconnection check passes. The state ownership move also matches the agreed intent but changes who can remove shared state. I recommend retaining it because the replacement connection now owns cleanup. The old-connection cleanup bug is repaired and validated. Approve these changes, request revisions, or defer a decision?

If the diff instead shortens the grace time contrary to the agreed intent, the reviewer flags the possible deliberate deviation with a recommendation before keeping or changing it. A requested revision is implemented and validated by the reviewer, and any materially changed effects are brought back for approval. A deferred material decision remains unresolved and prevents successful review.

Review reports scope, approvals, repairs, validation, and remaining concerns. It neither merges `main`, stages, nor commits. The human prepares integration and commits before Ship and returns for review if integration materially changes the reviewed effects. Unchanged effects do not need reapproval merely because they were committed.
