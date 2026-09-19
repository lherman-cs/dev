# dev toolbox

Personal development toolbox plus a small OMP-native engineering workflow.

## Workflow

You create the Git worktree yourself. The normal workflow is:

```text
/dev-spec
    semantic draft -> human approval
/dev-plan
    small immutable plans -> architecture/plan approval
/dev-ship
    build -> prepare draft PR -> await exact-HEAD signals
    -> adversarial review/repair -> final human approval -> ready PR
```

`/dev-build`, `/dev-prepare`, and `/dev-review` remain available as lower-level commands.

The workflow uses OMP primitives directly instead of maintaining a parallel agent runtime:

- native file slash commands under `~/.omp/agent/commands`
- native task agents under `~/.omp/agent/agents`
- `task` + Agent Hub for specialist workers
- bundled `scout` for narrow read-only exploration
- `todo` for visible phase/task progress
- `ask` for consequential human decisions and approvals
- fenced Mermaid in normal Markdown when a diagram reduces review effort

There is no custom workflow TUI, custom subagent implementation, or Pi workflow extension.

Durable project state remains ignored under `plans/<project>/`:

```text
spec.md
project.toon
progress.toon
plans/P001.toon
repairs/R001.toon
review.toon
```

Git remains implementation truth and the approved spec remains semantic truth. OMP session state handles live coordination; the small files above only carry project contracts and restartable progress that must outlive a session.

## Models

Role/model routing is native OMP configuration in:

```text
~/.omp/agent/config.yml
```

The specialist agents reference role aliases such as `@spec`, `@builder`, and `@review`. The bundled `scout` agent is routed through the `@explorer` role, so every workflow agent can delegate narrow exploration without carrying the research transcript in its own context.

See [WORKFLOW.md](WORKFLOW.md) for the contracts.

## Bootstrap

```sh
bash <(curl -L https://raw.githubusercontent.com/lherman-cs/dev/main/install.sh)
```

The installer installs OMP and TOON, links this repository's dotfiles, and removes retired Pi workflow assets. OMP already supplies the LSP, GitHub, browser/web, task, todo, ask, and subagent surfaces that previously required custom code or Pi plugins.

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
