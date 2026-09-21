# Agent Hub: daily use and boundaries

The main Pi conversation is home. `Alt+A` or `/dev-workers` opens one hub for every registered child, whether created by a skill's Explorer or a controller. Opening, inspecting, searching and copying never invoke a model or restart a completed worker.

## Learn while working

The widget names active tasks and new results. The roster uses stable order, purpose-first labels and parent information. Wide terminals show an inspector; `Tab` reveals it on narrow terminals. Back/Help stay visible in short layouts. Extremely small terminals disable hidden editing rather than accept invisible input.

| Surface | Controls |
| --- | --- |
| Anywhere in the hub | `Alt+A` returns to Main; `Esc` backs out one level and preserves drafts; `F1` opens contextual help. |
| Roster | `↑↓` / `j k` select, `Enter` opens the thread, `F3` or `/` filters, `Tab` shows narrow-terminal details. |
| Thread | Type normally; native editor Submit sends to the displayed recipient. `Alt+↑/↓` changes child threads; each has a separate draft/cursor/reading position. |
| Evidence | `PgUp/PgDn` browse anchored history, `F4` follows live, `F3` searches, `Ctrl+O` expands tools. `F2` includes copying the complete available text and toggling provider-supplied thinking. |
| Actions | `F2` lists only relevant actions: queue the draft after current work, restore undelivered input, stop, controller pause/resume/respond, or start a related investigation. |

The display neutralizes untrusted terminal-control/Bidi escapes without modifying the retained raw evidence.

The editor uses Pi's native multiline editing and submit binding; Left/Home/End are not navigation commands. Question marks are ordinary text in the editor. Navigation help derives the Submit label from the native keybinding. The actions menu provides a follow-up path without relying on terminal-specific modified Enter sequences.

## Sending and stopping

The named recipient is fixed when a message is submitted. Slash-prefixed examples are sent literally, without executing a command or expanding a skill. A failed send retains its draft; accepting an older send never erases newer edits. Queue receipts distinguish sending, queued, delivered, failed and cancelled. F2 can cancel all still-queued messages; their original text remains recoverable. Delivered means the instruction entered the child's conversation, not that the model necessarily complied. Native steering waits for the next turn boundary; it does not terminate already-running commands. Pending undelivered messages remain recoverable if the agent stops.

Stop is explicit and defaults to Cancel. Stopping a nested Explorer need not stop its parent; the confirmation describes that scope. Controller-owned Builder cancellation stops the controller rather than pretending the contract completed. Neither stopping nor pausing rolls back executed edits, commits, network requests or other effects.

`/dev-pause` lets the current safe step finish, then exits the controller with durable progress preserved. `/dev-stop` cancels the controller and all registered child agents. Wait for the displayed Paused/Stopped state before manual edits. `/dev-continue` or F2 fast continuation revalidates the paused HEAD, tracked/untracked contents and ignored approved contracts. Changed work refuses fast continuation; reconcile it, then explicitly rerun the original `/dev-<phase> <target>`. Existing Git reality, worktree cleanliness and exact-candidate validation still apply. Do not expect inspection or a hub message to bypass those checks.

Main stays Main. While another controller/writing child owns the repository, mutating Main tools and shell commands are blocked to prevent competing writers. Reading, conversation and narrow exploration remain available. Input is never silently forwarded to whichever Builder happens to be active.

## Human approval without focus surprises

Controller questions produce a persistent Needs-you status, not an unsolicited modal. Explicitly select Respond in F2 or run `/dev-respond` to open the native question. A Main turn synchronously waiting on an Explorer can answer without aborting it. Children can call `ask_human`; those questions use the same explicitly claimed UI. Stopping a child also cancels its actual question dialog. Unsent multiline responses are recovered alongside Main’s existing draft rather than silently discarded. Cancel is the initial choice. A key typed while composing in another thread cannot approve an exact candidate. Stop cancels pending decisions, and the controller revalidates candidate/evidence after the decision. Feedback through a live Reviewer invalidates previous structured results; it cannot reuse an earlier PASS.

## History and truthful status

Child sessions use Pi's JSONL storage under `<parent-session-file>.workers/`, not a separate database. Display metadata, delivery receipts and drafts are native custom entries. Parent controller-only sessions are persisted without a fabricated model turn, using the pinned native SessionManager. New files are private (0600, directories 0700). The hub lazily reloads older transcripts; dropping a memory cache does not delete a thread or retarget a draft.

Histories from the earlier PR journal layout are read without deleting them, restricted to the current parent and worktree.

On normal close, draft writes flush. Edits are debounced for 250 ms, so a hard process kill can lose the newest unflushed keystrokes. Unfinished saved threads restore as Interrupted, never as falsely active. Missing/damaged files are reported without hiding healthy histories. Historical threads are read-only; F2 can create a NEW read-only Explorer from a follow-up draft. This does not mutate an accepted Builder result, refresh an old review verdict, or automatically notify its former parent. Explicitly bring new findings back to Main/the controller.

A worker finishing is distinct from its contract passing verification. The inspector shows the controller's accepted HEAD only after independent checks and progress persistence. Context is current native context usage, while processed tokens/replies summarize available completed assistant-message usage. Unknown values show a dash. Reported cost is not subscription billing. VCC availability is taken from the actual child configuration; VCC retains a per-child recall boundary rather than inheriting sibling/Main conversations.

Child histories are kept locally until you remove their parent artifacts. They may contain source code, prompts and tool output; handle them with the same care as ordinary Pi sessions. Do not attach private histories to public bug reports. A controller's full available stdout/stderr are inspectable in native parent audit entries, outside the model prompt.

## External child-session integration

Other Pi extensions may request a parent-scoped adapter through the existing event bus. This is a UI/lifecycle registration boundary, not a subagent spawning API:

```ts
let hub;
pi.events.emit("dev:worker-hub", {
  sessionId: ctx.sessionManager.getSessionId(),
  receive: adapter => { hub = adapter; },
});
// The owner creates/configures the AgentSession and keeps its own policies.
// Optionally pass hub.createSessionManager(cwd, metadata) to createAgentSession.
const handle = hub.register({
  id: uniqueId,
  label: "Debugger · Event-loop stall",
  role: "debugger",
  model: session.model.id,
  thinking: session.thinkingLevel,
  session,
  metadata: { cwd, task: "Inspect the event loop", readOnly: true, parentId },
  actions: {
    send: (text, mode) => owner.send(text, mode),
    stop: () => owner.stop(),
  },
});
handle.update({ accepting: true });
// Seal before settlement; finish snapshots history but does not dispose it.
handle.update({ accepting: false });
handle.finish("completed");
session.dispose();
```

The owner must enforce delivery/settlement boundaries, descendant cancellation, permissions and any result validation. Mark unknown write capability conservatively; readOnly is not a sandbox. The adapter cannot be reused after its parent session changes. Unregistered sessions from unrelated extensions are not magically discovered.

## Validation

Tests use the pinned Pi runtime with deterministic provider streams, real native editors/renderers and real Git fixtures. Coverage includes recipient isolation, multiline/Unicode editing, late-send races, queued-vs-delivered receipts, stale verdicts, nested cancellation, native persistence before a first response, restart/eviction recovery, long streaming output, anchored history/search, custom tool renderers, image fallbacks, narrow/tiny layouts, observer cleanup, controller pause boundaries, explicit approvals and Main write ownership. Actual VCC compaction and per-child recall are exercised.

Keyboard-first behavior is the baseline. No OMP dependency, new scheduler, worktree manager, automatic worker revival, web dashboard or model-selection policy is introduced. Terminal-specific pointer/clipboard/image capabilities remain those of the pinned Pi runtime and terminal; automated rendering tests do not certify every terminal emulator or real provider/network behavior.
