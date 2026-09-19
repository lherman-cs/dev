# dev toolbox

Personal development toolbox plus a deliberately small Pi-first engineering workflow.

## Workflow

You create the Git worktree yourself. The normal workflow is:

```text
/dev-spec
    rich semantic brief -> human approval
/dev-plan
    small immutable plans -> rich plan brief -> human approval
/dev-ship
    build
    -> rebase + local final gates
    -> push/update draft PR
    -> wait for exact-HEAD CI/review feedback
    -> adversarial machine review
    -> bounded automatic repair loop
    -> final rich human review
    -> concise PR + mark ready
```

`/dev-build`, `/dev-prepare`, and `/dev-review` remain available as lower-level commands.

The shipping loop is deterministic TypeScript, not an orchestrator agent. Models are disposable workers for implementation, rebase-conflict judgment, and substantive review. GitHub waiting/polling uses ordinary `gh` calls and consumes no model tokens.

Durable state stays small and ignored under `plans/<project>/`:

```text
spec.md
project.toon
progress.toon
ship.toon
plans/P001.toon
repairs/R001.toon
review.toon
```

`progress.toon` tracks Builder execution. `ship.toon` tracks only the small shipping phase/candidate/checkpoint needed for interruption-safe resume. Git remains implementation truth; the approved spec remains semantic truth.

Shipping automatically blocks instead of blindly looping when the same repaired failure recurs, the bounded repair rounds are exhausted, or correct resolution requires a new semantic decision.

## Rich Pi review UX

Human review efficiency is a primary requirement. Spec, Plan, and Review use the `workflow_brief` Pi tool to render a fullscreen, interactive review surface with Markdown, panels/tabs, diagrams, code/data views, selectable repairs, optional inline images, mouse input, and keyboard navigation. The model generates semantic content; the extension owns presentation so rich UX does not require generating HTML/CSS.

Use a terminal with strong fullscreen/mouse/image support such as Ghostty, Kitty, or WezTerm for the best experience. `~/.pi/agent/settings.json` enables fullscreen mode and images.

## Explorer

`explore` is a first-class internal subagent primitive. Specifier, Planner, Builder, and Reviewer should fan out narrow read-only questions when that improves speed, context efficiency, or confidence. Explorer sessions are fresh, use the configured cheap model, may run in parallel, and return compact evidence packets instead of transcripts. Their live activity remains visible in Pi.

## Models

Role/model choice is configuration, not workflow logic. Edit:

```text
~/.pi/agent/dev-workflow.json
```

Defaults are intentionally different per job (Specifier, Planner, Builder, Builder retry, Explorer, Prepare, Reviewer, Shipper). Missing or ambiguous configured models fail visibly; the workflow never silently falls back to another model.

See [WORKFLOW.md](WORKFLOW.md) for the contracts.

## Bootstrap

```sh
bash <(curl -L https://raw.githubusercontent.com/lherman-cs/dev/main/install.sh)
```

The installer installs Pi and TOON, links this repository's dotfiles, and removes retired workflow assets from older versions.

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
