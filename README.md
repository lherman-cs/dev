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
```

All six phases have the same interface: no prompt opens the selected interactive model; a prompt invokes the same `/dev-<phase>` command you would type manually. Spec/Plan stay in the current conversation. Build/Prepare/Review/Ship are deterministic code; fresh native SDK workers handle bounded judgment. Every role can use narrow read-only `explore`. There is no `pi-subagents`, agent registry, coordinator model, background scheduler, or custom rendering stack. `/dev-stop` cancels through Pi.

Your exact eight role strings remain in `pi/roles.json`. The separate `authProvider: "openai-codex"` uses subscription login for the same model IDs. API-key users can explicitly choose `openai`. No model/provider fallback is attempted. Pi credentials are not copied from OMP; use Pi `/login` when needed.

## Installation

```sh
./install.sh
# Agent-only update from this checkout:
./scripts/install-pi.sh
```

Node 22.19+ is required. Installation uses the checked-in lockfile with lifecycle scripts disabled, registers one local Pi package, and deduplicates only the listed plugins. Existing Pi/OMP settings, credentials, and user instructions are not overwritten. Original user-wide preferences are seeded only when Pi has no `AGENTS.md`.

Requested plugins: `@narumitw/pi-lsp`, `@narumitw/pi-github-pr`, `@narumitw/pi-chrome-devtools`, `@narumitw/pi-usage`, `pi-web-access`, and `pi-mcp-adapter`. Existing RPIV task and structured-question plugins remain for human interaction. No MCP server or browser-cookie access is enabled by this repository. Pins and trust boundaries are in [pi/DEPENDENCIES.md](pi/DEPENDENCIES.md).

`dev a` launches the pinned Pi runtime at `~/.pi/agent/dev-workflow`. `PI_CODING_AGENT_DIR` and `DEV_PI_PACKAGE` are respected. Role changes are read directly from `pi/roles.json`; there are no generated agent definitions.

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
