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

All six phases have the same interface: no prompt opens the selected interactive model; a prompt invokes the same `/dev-<phase>` command you would type manually. Spec/Plan stay in the current conversation. Build/Prepare/Review/Ship are deterministic code; fresh native SDK workers handle bounded judgment. Every role can use narrow read-only `explore`. There is no `pi-subagents`, coordinator model, background scheduler, or second orchestration layer. `/dev-stop` cancels through Pi.

## Agent Hub

`Alt+A` opens the same session-wide Agent Hub for controller workers and children spawned directly from Main. Choose an agent, press `Enter`, and use its named-recipient editor. Each thread keeps its own multiline draft and reading position. `Esc` goes back without stopping work; `Alt+A` returns directly to Main. `F1` teaches the controls, `F2` shows available actions, `F3` searches, and `F4` returns to live output. Full native Pi messages, tool results, and streaming output are inspectable; long output can be expanded and copied.

`/dev-pause` pauses a controller at a safe boundary; `/dev-stop` cancels the controller and child agents without undoing existing changes. Wait for Paused/Stopped before editing manually. Main remains the main conversation, not an implicit message router. Controller decisions wait visibly until you explicitly choose **Respond** or run `/dev-respond`; typing in a worker never approves a candidate.

Native child sessions and drafts are saved beside the parent Pi session and restored as historical threads. Opening history never restarts an agent. A completed Builder stays read-only; a follow-up starts a separate read-only investigation through its owner. Git/TOON state remains the workflow authority. [Controls, recovery, integration and validation](pi/AGENT_HUB.md).

Skills use **Pi's native lazy-skill mechanism**. Only skill names/descriptions are discoverable up front; the full `SKILL.md` body is injected only by an explicit `/skill:dev-*` invocation. Bare `dev a <phase>` therefore does not preload phase instructions into the session. Fresh workers discover only the one assigned skill and invoke it natively for that task.

Your exact eight role strings remain in `pi/roles.json`. The separate `authProvider: "openai-codex"` uses subscription login for the same model IDs. API-key users can explicitly choose `openai`. No model/provider fallback is attempted. Pi credentials are not copied from OMP; use Pi `/login` when needed.

## Installation

```sh
./install.sh
# Agent-only update from this checkout:
./scripts/install-pi.sh
```

Node 22.19+ is required. Installation reconciles the checked-in Pi settings and pi-vcc configuration from `dotfiles/.pi/agent/`, uses the checked-in lockfile with lifecycle scripts disabled, registers one local Pi package, and deduplicates only the listed plugins. Credentials and existing user instructions are not overwritten. Original user-wide preferences are seeded only when Pi has no `AGENTS.md`.

Requested plugins: `@narumitw/pi-lsp`, `@narumitw/pi-github-pr`, `@narumitw/pi-chrome-devtools`, `@narumitw/pi-usage`, `pi-web-access`, and `pi-mcp-adapter`. Existing RPIV task and structured-question plugins remain for human interaction. No MCP server or browser-cookie access is enabled by this repository. Pins and trust boundaries are in [pi/DEPENDENCIES.md](pi/DEPENDENCIES.md).

`dev pi` launches the pinned Pi runtime and passes arguments through unchanged. `dev a` uses the same runtime. Both fail early if the installed package-local executable is missing. `PI_CODING_AGENT_DIR` and `DEV_PI_PACKAGE` are respected. Role changes are read directly from `pi/roles.json`; there are no generated agent definitions.

## Contracts and verification

Approved TOON plans, `progress.toon`, and restartable `ship.toon` remain supported. An existing spec without execution plans reports the missing planning step, not “Unknown project.” Workflow state is ignored through local Git metadata, without changing repository `.gitignore`.

Permanent CI covers the actual published plugin loader, native SDK sessions with a simulated provider transport, exact model routing, instruction regressions, real Git/TOON recovery and shipping gates, and Rust CLI behavior. Live account entitlements and remote browser/MCP services are not exercised by those tests.

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
