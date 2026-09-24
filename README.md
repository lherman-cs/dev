# dev toolbox

Personal developer tools with a Pi-first workflow. Pi owns sessions, authentication, tool execution, and rendering. This repository supplies a role table, compact lazy skills, and isolated child-session boundaries, not a second agent harness.

## Daily use

```sh
dev a spec                         # select the configured model and open Pi
# discuss normally, then /dev-spec when ready
dev a build "Implement the approved media-signaling change"
dev a review "Review and converge the local media-signaling candidate"
dev a ship "Package the reviewed candidate into clean commits"
dev a resume                       # interactive Pi session picker
dev a stats                        # interactive Pi session dashboard
```

`dev a resume` opens Pi's session picker; `dev a resume <session-id-or-path>` opens that session directly. The public phases are exactly `spec`, `build`, `review`, and `ship`. With no prompt, `dev a <phase>` opens the configured interactive Pi session. A prompt invokes the matching current-session `/dev-<phase>` alias. Each alias explicitly loads its `dev-<phase>` skill.

Spec and Review are collaborative goal-bearing phases. Spec converges the smallest approved outcome. Build implements it. Review then merges the current local integration branch (normally `main`) into the development candidate, resolves integration conflicts, deeply reviews and repairs the result, and progressively keeps the CTO's system model current. Review owns technical convergence and consequential human decisions; it does not delegate judgment to a separate Reviewer sub-agent.

Ship is deliberately mechanical and does not activate a goal. It treats the reviewed tree as immutable input, creates an isolated `ship/<name>` branch, rebuilds the change as a minimal linear Conventional Commit history on the exact reviewed integration baseline, mechanically proves tree equivalence, and leaves a branch that can fast-forward from the exact reviewed baseline. Development merge commits never appear in the shipping history. If `main` has moved beyond the reviewed baseline or exact equivalence cannot be proven, Ship stops rather than changing content. Integration and remote publishing remain human-owned.

`explore` starts a separate bounded Explorer child session in its own HEAD snapshot for investigation. Uncommitted owner edits are not in that snapshot; inspect them as owner or supply explicit read-only evidence. Parent agents delegate substantial read-only investigation, while quick known-target reads may stay direct. Explorer may investigate but does not run checks, edit, make project decisions, or delegate. `verify({ commands, cwd?, prerequisites?, timeoutMs? })` dispatches tests, builds, lints, benchmarks, and acceptance gates against the actual owner worktree, including dirty files. It returns immediately with a receipt; asynchronous evidence includes candidate fingerprint, exits, duration, excerpts, and retained logs. Keep the candidate unchanged until the check completes or is cancelled. Verifier does not repair, install, or mutate Git. Review is a foreground phase rather than a child-review tool. Explorer and Verifier remain supporting evidence mechanisms; they never own product decisions or phase sequencing.

## Agent Hub

`Alt+A` opens the session-wide Agent Hub for native child sessions. Choose a child, press `Enter`, and use its named-recipient editor. Each thread keeps its own multiline draft and reading position. `Esc` goes back without stopping work; `Alt+A` returns directly to Main. `F1` teaches the controls, `F2` shows available actions, `F3` searches, and `F4` returns to live output. Full native Pi messages, tool results, and streaming output are inspectable; long output can be expanded and copied.

The Hub is inspection and owner action UI, not a scheduler or workflow authority. Stopping a child does not undo existing changes. Completed children remain read-only. Native child sessions and drafts are saved beside the parent Pi session and restored as historical threads. Opening history never restarts an agent. See [Agent Hub controls and recovery](pi/AGENT_HUB.md).

Skills use **Pi's native lazy-skill mechanism**. Only skill names and descriptions are discoverable up front; the `SKILL.md` body is injected only by an explicit `/skill:dev-*` invocation. Bare `dev a <phase>` therefore does not preload phase instructions into the session.

The role strings live in `pi/roles.toml`, which supports `#` comments. The separate `authProvider = "openai-codex"` uses subscription login for the same model IDs. API-key users can explicitly choose `openai`. No model or provider fallback is attempted. Pi credentials are not copied from OMP; use Pi `/login` when needed.

## Installation

```sh
./install.sh
# Agent-only update from this checkout:
./scripts/install-pi.sh
```

Node 22.19+ is required. Installation reconciles checked-in Pi settings and pi-vcc configuration from `dotfiles/.pi/agent/`, uses the checked-in lockfile with lifecycle scripts disabled, registers one local Pi package, and deduplicates only the listed plugins. Credentials and existing user instructions are not overwritten. Original user-wide preferences are seeded only when Pi has no `AGENTS.md`.

Requested plugins: `@narumitw/pi-lsp`, `@narumitw/pi-github-pr`, `@narumitw/pi-chrome-devtools`, `@narumitw/pi-usage`, `pi-web-access`, and `pi-mcp-adapter`. Existing RPIV task and structured-question plugins remain for human interaction. No MCP server or browser-cookie access is enabled by this repository. Pins and trust boundaries are in [pi/DEPENDENCIES.md](pi/DEPENDENCIES.md).

`dev pi` launches the pinned Pi runtime and passes arguments through unchanged. `dev a` uses the same runtime. Both fail early if the installed package-local executable is missing. `PI_CODING_AGENT_DIR` and `DEV_PI_PACKAGE` are respected. Role changes are read directly from `pi/roles.toml`; there are no generated agent definitions.

## Contracts and verification

The current request, applicable approved decisions (including conversational approval), Git/worktree history, repository conventions, and local validation are recovery evidence. A persisted spec is optional; ignored `plans/` artifacts do not follow another worktree, so put cross-worktree decisions in a tracked path. There is no repository workflow-state artifact. Permanent CI covers the published plugin loader, native SDK sessions with a simulated provider transport, exact model routing, instruction regressions, Agent Hub behavior, and Rust CLI behavior. Live account entitlements and remote browser/MCP services are not exercised by those tests.

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
