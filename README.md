# dev toolbox

Personal developer tools and a Pi-first workflow. Pi owns sessions, authentication, tool execution, and rendering. This repo owns the role table, small skills, and deterministic lifecycle checks, not a second agent harness.

## Daily use

```sh
dev a spec                         # correct model/thinking, no invented turn
# discuss normally, then /dev-spec when ready
dev a plan                         # discuss, then /dev-plan
dev a build ./plans/media-signaling-core/spec.md
dev a prepare ./plans/media-signaling-core/spec.md
dev a review ./plans/media-signaling-core/spec.md
dev a ship ./plans/media-signaling-core/spec.md
dev a resume                       # native Pi continuation
dev a stats                        # interactive Pi session dashboard for this directory
```

All six phases have the same interface: no prompt opens the selected interactive model; a prompt invokes the same `/dev-<phase>` command you would type manually. Spec/Plan stay in the current conversation. Build/Prepare/Review/Ship are deterministic code; fresh native SDK workers handle bounded judgment. Every role can use narrow read-only `explore`. There is no `pi-subagents`, coordinator model, background scheduler, or second orchestration layer.

## Agent Hub

Main is home. `Alt+A` (or `/dev-workers`) opens the same Agent Hub for Explorers spawned in ordinary conversation and workers created by any `/dev-*` controller. Choose a purpose-labelled agent with `↑↓`, press `Enter` to open its thread, and use `Esc` to go back. Opening or closing a thread never stops or restarts work.

The footer teaches the immediate controls. `F1` opens help; `F2` offers only the selected thread's available actions, pending human questions, and workflow controls. On wide terminals the roster has an inspector; on narrow terminals the same details are available through `F2`. `/` filters the roster. Very small viewports refuse invisible typing and keep an escape route visible.

### Messages and inspection

The composer names its recipient. Each thread retains its own draft, cursor, undo state, and history position. Native multiline paste and normal cursor editing are preserved. `Enter` queues steering at the next delivery boundary; it does **not** cancel an executing command. `F2` also offers follow-up after the current work, with `Ctrl+Enter` as an optional shortcut.

Queued and delivered are distinct: delivered means added to the agent's context, not necessarily obeyed. Failed, cancelled, or undelivered text stays recoverable under `F2 → Messages`. Drafts are saved locally after a short debounce and on navigation/close. As with any editor, a hard process or power failure can lose changes made since the last save.

`Alt+↑/↓` switches child threads. `PgUp/PgDn` browses anchored history without chasing new output; `Alt+End` returns to live output. `Ctrl+O` expands native tool output. `F2` provides raw evidence, transcript search/copy, task and parent information, context usage, and controller verification outcomes. Provider-reported cost is not a subscription charge; unavailable metrics are shown as unknown.

### Human control

Human questions and approvals appear as pending requests, not surprise dialogs. Open `F2 → Answer` or `/dev-attention` to respond explicitly. Cancelling a multiline response preserves unsent text in Main's draft; it does not send it.

`F2 → Pause workflow` or `/dev-pause` requests a safe controller boundary. Wait until its status is **paused**. `F2 → Continue` or `/dev-continue` revalidates the worktree and approved artifacts before continuing. For manual edits or scope changes, stop the workflow, reconcile in Main, and restart the original `/dev-*` command. A changed paused snapshot cannot reuse old evidence.

`F2 → Stop agent` identifies the affected owner and asks for confirmation. `/dev-stop` stops the whole active workflow. Stop requests cancellation; it never rolls back edits or external side effects. Main remains available for discussion and read-only exploration during controller work, but competing writes are blocked.

### History and boundaries

Child transcripts use Pi-native session files, with local per-thread drafts and receipt metadata. Resuming Main restores inspectable history; unfinished historical attempts are marked interrupted, not falsely running. `F2` can load earlier Main-session history from the same worktree. Completed attempts remain read-only. An explicit new read-only follow-up starts a separate Explorer and cannot replace an already accepted Builder result.

The hub only observes supplied sessions and calls their owner-provided controls. All children from this package register at the shared worker boundary. Other extensions can opt in through the `dev:agent-hub` producer event; unrelated sessions are not magically discovered. Controllers still own scheduling, Git, verification, repairs, and exact-candidate approval.

## Skills and models

Skills use **Pi's native lazy-skill mechanism**. Only skill names/descriptions are discoverable up front; the full `SKILL.md` body is loaded when the skill is invoked. Bare `dev a <phase>` does not preload phase instructions into the session. Fresh workers discover only the assigned skill and invoke it natively for that task.

Your exact eight role strings remain in `pi/roles.json`. The separate `authProvider: "openai-codex"` uses subscription login for the same model IDs. API-key users can explicitly choose `openai`. No model/provider fallback is attempted. Pi credentials are not copied from OMP; use Pi `/login` when needed. VCC is explicitly loaded in child sessions, including its recall tools; Main's plugin list alone is not treated as proof of child capability.

## Installation

```sh
./install.sh
# Agent-only update from this checkout:
./scripts/install-pi.sh
```

Node 22.19+ is required. Installation reconciles the checked-in Pi settings and pi-vcc configuration from `dotfiles/.pi/agent/`, uses the checked-in lockfile with lifecycle scripts disabled, registers one local Pi package, and deduplicates only the listed plugins. Credentials and existing user instructions are not overwritten. Original user-wide preferences are seeded only when Pi has no `AGENTS.md`.

Requested plugins: `@narumitw/pi-lsp`, `@narumitw/pi-github-pr`, `@narumitw/pi-chrome-devtools`, `@narumitw/pi-usage`, `pi-web-access`, and `pi-mcp-adapter`. Existing RPIV task and structured-question plugins remain for human interaction. No MCP server or browser-cookie access is enabled by this repository. Pins and trust boundaries are in [pi/DEPENDENCIES.md](pi/DEPENDENCIES.md).

`dev a` launches the pinned Pi runtime at `~/.pi/agent/dev-workflow`. `PI_CODING_AGENT_DIR` and `DEV_PI_PACKAGE` are respected. Role changes are read directly from `pi/roles.json`; there are no generated agent definitions.

## Contracts and verification

Approved TOON plans, `progress.toon`, and restartable `ship.toon` remain supported. An existing spec without execution plans reports the missing planning step, not “Unknown project.” Workflow state is ignored through local Git metadata, without changing repository `.gitignore`.

Permanent CI covers the actual published plugin loader, native SDK sessions with a simulated provider transport, exact model routing, instruction regressions, real Git/TOON recovery and shipping gates, and Rust CLI behavior. Interaction regressions exercise per-recipient drafts, native multiline editing, delivery races, nested cancellation, explicit human questions, session history, filtered navigation, safe stop confirmation, viewport geometry, and lifecycle cleanup. Live account entitlements, actual terminal-emulator integration, and remote browser/MCP services are not exercised by those automated tests.

See [WORKFLOW.md](WORKFLOW.md) and the [baseline intention review](pi/INSTRUCTION_REVIEW.md).

## Other toolbox notes

### LSP configs

<https://github.com/neovim/nvim-lspconfig/blob/main/CONFIG.md>

### Different SSH keys per project

```text
Host personal
    HostName github.com
    User git
    IdentityFile ~/.ssh/personal
    IdentitiesOnly yes
```

### Missing Nerd symbols

<https://webinstall.dev/nerdfont/>

### Toggle Linux text/graphical mode

```sh
sudo systemctl isolate multi-user.target
sudo systemctl isolate graphical.target
```
