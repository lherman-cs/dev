# dev toolbox

Personal developer tools with a Pi-first workflow. Pi owns sessions, authentication, tool execution, and rendering. This repository supplies a role table, compact lazy skills, and isolated child-session boundaries, not a second agent harness.

## Daily use

```sh
dev a spec                         # select the configured model and open Pi
# discuss normally, then /dev-spec when ready
dev a plan ./plans/media-signaling-core/spec.md
dev a build ./plans/media-signaling-core/plan.md
dev a ship ./plans/media-signaling-core/plan.md
dev a resume                       # interactive Pi session picker
dev a stats                        # interactive Pi session dashboard
```

`dev a resume` opens Pi's session picker; `dev a resume <session-id-or-path>` opens that session directly. The public phases are exactly `spec`, `plan`, `build`, and `ship`. With no prompt, `dev a <phase>` opens the configured interactive Pi session. A prompt invokes the matching current-session `/dev-<phase>` alias. Each alias explicitly loads its `dev-<phase>` skill. The active conversation owns spec, plan, and build work. The foreground Shipper observes live Git and GitHub state, coordinates asynchronous Builder and Reviewer workers, and seeks explicit approval of the final readiness packet. It never merges.

`explore` starts a separate bounded Explorer child session for investigation or targeted verification. Parent agents delegate read-only evidence gathering expected to take material time or produce substantial raw output, while quick known-target reads and small checks may stay direct. Explorer may run commands but cannot edit through agent tools, make project decisions, or delegate. During an explicit `dev-ship` invocation only, `review({ task, candidate, evidence })` can start a fresh, read-only Reviewer child session. Every child-agent launch returns a job receipt immediately and delivers its bounded result separately as soon as it settles. This includes worker-owned Explorers and the fixed ship runtime's Builder and Reviewer launches. Callers never await child agents: they continue independent work and, if a result gates the next decision, resume from the asynchronous completion instead of polling or duplicating it. If Explorer fails or is unavailable, a parent may disclose an output-bounded direct read-only fallback, but gains no otherwise prohibited capability. The active Shipper must still verify current local and remote identity, evidence, and human confirmation.

## Agent Hub

`Alt+A` opens the session-wide Agent Hub for native child sessions. Choose a child, press `Enter`, and use its named-recipient editor. Each thread keeps its own multiline draft and reading position. `Esc` goes back without stopping work; `Alt+A` returns directly to Main. `F1` teaches the controls, `F2` shows available actions, `F3` searches, and `F4` returns to live output. Full native Pi messages, tool results, and streaming output are inspectable; long output can be expanded and copied.

The Hub is inspection and owner action UI, not a scheduler or workflow authority. Stopping a child does not undo existing changes. Completed children remain read-only. Native child sessions and drafts are saved beside the parent Pi session and restored as historical threads. Opening history never restarts an agent. See [Agent Hub controls and recovery](pi/AGENT_HUB.md).

Skills use **Pi's native lazy-skill mechanism**. Only skill names and descriptions are discoverable up front; the `SKILL.md` body is injected only by an explicit `/skill:dev-*` invocation. Bare `dev a <phase>` therefore does not preload phase instructions into the session.

The six role strings remain in `pi/roles.json`. The separate `authProvider: "openai-codex"` uses subscription login for the same model IDs. API-key users can explicitly choose `openai`. No model or provider fallback is attempted. Pi credentials are not copied from OMP; use Pi `/login` when needed.

## Installation

```sh
./install.sh
# Agent-only update from this checkout:
./scripts/install-pi.sh
```

Node 22.19+ is required. Installation reconciles checked-in Pi settings and pi-vcc configuration from `dotfiles/.pi/agent/`, uses the checked-in lockfile with lifecycle scripts disabled, registers one local Pi package, and deduplicates only the listed plugins. Credentials and existing user instructions are not overwritten. Original user-wide preferences are seeded only when Pi has no `AGENTS.md`.

Requested plugins: `@narumitw/pi-lsp`, `@narumitw/pi-github-pr`, `@narumitw/pi-chrome-devtools`, `@narumitw/pi-usage`, `pi-web-access`, and `pi-mcp-adapter`. Existing RPIV task and structured-question plugins remain for human interaction. No MCP server or browser-cookie access is enabled by this repository. Pins and trust boundaries are in [pi/DEPENDENCIES.md](pi/DEPENDENCIES.md).

`dev pi` launches the pinned Pi runtime and passes arguments through unchanged. `dev a` uses the same runtime. Both fail early if the installed package-local executable is missing. `PI_CODING_AGENT_DIR` and `DEV_PI_PACKAGE` are respected. Role changes are read directly from `pi/roles.json`; there are no generated agent definitions.

## Contracts and verification

Approved Markdown specs and plans, Git history, and remote state are recovery truth. There is no repository workflow-state artifact. Permanent CI covers the published plugin loader, native SDK sessions with a simulated provider transport, exact model routing, instruction regressions, Agent Hub behavior, and Rust CLI behavior. Live account entitlements and remote browser/MCP services are not exercised by those tests.

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
