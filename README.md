# dev toolbox

Personal developer tools with a Pi-first workflow. Pi owns sessions, authentication, tool execution, and rendering. This repository supplies a role table, compact lazy skills, and isolated child-session boundaries, not a second agent harness.

## Daily use

```sh
dev a spec                         # select the configured model and open Pi
# discuss normally, then /dev-spec when ready
dev brief --base main              # captured worktree comparison, saved browser brief
dev brief --range v1...v2         # exact committed comparison (no working edits)
dev brief --open latest           # reopen without Pi
dev a brief "Focus on rollout risk" # same brief through the Pi phase
dev a build "Implement the approved media-signaling change"
dev a review "Review the local media-signaling candidate"
dev a ship                         # approve one squash commit to local main
dev a resume                       # interactive Pi session picker
dev a stats                        # interactive Pi session dashboard
```

`dev a resume` opens Pi's session picker; `dev a resume <session-id-or-path>` opens that session directly. The public phases are exactly `spec`, `brief`, `build`, `review`, and `ship`. With no prompt, `dev a <phase>` opens the configured interactive Pi session. A prompt invokes the matching current-session `/dev-<phase>` alias. Each alias explicitly loads its `dev-<phase>` skill.

Brief is a read-only, optional communication phase, independent of Spec/Build/Review/Ship. `dev brief` captures the merge-base of the locally discoverable default branch and `HEAD` against the effective current tree (staged, unstaged, untracked; ignored files excluded). `--base <branch>` selects another local base; `--range A..B` compares the exact committed endpoint trees and `--range A...B` compares their merge-base to B, excluding working edits. No remote fetch, checkout, staging of the user's index, or commit occurs. If the default branch is missing or ambiguous, supply `--base`. `--spec <path>` adds explicit intent; it is not treated as evidence of implementation. The saved revision, bounded captured input, and feedback live outside the repository under XDG data storage. `--list` lists revisions and `--open <id|latest>` reopens without regeneration. The localhost viewer renders diagrams, keeps comment drafts per statement, marks stale snapshots, and exports compact Markdown feedback with revision IDs and code anchors. A general note explicitly has no code target. The local server lasts until `Ctrl+C`; commenting and exporting use the viewer, which requires a browser. Generation prints capture, Pi, and save stages to stderr while the final URL stays on stdout.

Spec and Review are collaborative goal-bearing phases. Spec converges the smallest approved outcome. Build implements it. Review examines the existing diff, including relevant uncommitted work, against agreed intent; repairs and validates clear in-scope bugs; and obtains explicit human approval for all consequential changes, including spec-compliant behavior and major design choices. It does not require a new spec, merge, stage, or commit. The human prepares integration and commits, returning for review if integration materially changes reviewed effects. Review remains foreground rather than delegating judgment to a Reviewer sub-agent.

Ship is a guarded local operation and does not activate a goal. The runtime requires a clean committed feature branch with local `main` integrated, checks a checked-out main for safety, and asks the model only for a Conventional Commit title and body. The human may tweak the message repeatedly, cancel, or approve the exact message and shipping to local main. The runtime rechecks source and main, creates one squash commit with ordinary Git hooks and signing, and fast-forwards local main, updating its checkout when present. The feature branch remains untouched; no shipping branch or remote operation is created. A repeated invocation with the same tree as main is a no-op.

`explore` starts a separate bounded Explorer child session that reads the parent's live files, including ignored plans and uncommitted edits. Explorer has no shell or file-writing tools; concurrently changing files can affect its evidence. Parent agents delegate substantial read-only investigation, while quick known-target reads may stay direct. Explorer may investigate but does not run checks, edit, make project decisions, or delegate. `verify({ commands, cwd?, prerequisites?, timeoutMs? })` dispatches tests, builds, lints, benchmarks, and acceptance gates against the actual owner worktree, including dirty files. It returns immediately with a receipt; asynchronous evidence includes candidate fingerprint, exits, duration, excerpts, and retained logs. Keep the candidate unchanged until the check completes or is cancelled. Verifier does not repair, install, or mutate Git. Review is a foreground phase rather than a child-review tool. Explorer and Verifier remain supporting evidence mechanisms; they never own product decisions or phase sequencing.

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

Node 22.19+ is required. Installation generates `dev` shell completions for Bash and Zsh and adds an idempotent hook to the current shell's rc file; restart your shell to activate them. For other shells, use `dev completions <shell>` and follow that shell's loading conventions. Installation reconciles checked-in Pi settings and pi-vcc configuration from `dotfiles/.pi/agent/`, uses the checked-in lockfile with lifecycle scripts disabled, registers one local Pi package, and deduplicates only the listed plugins. Credentials and existing user instructions are not overwritten. Original user-wide preferences are seeded only when Pi has no `AGENTS.md`.

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
