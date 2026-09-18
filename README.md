# dev toolbox

Personal development toolbox plus a deliberately small Pi-first engineering workflow.

## Workflow

You create the Git worktree yourself. The workflow starts inside that worktree:

```text
/dev-spec
    rich Pi spec brief -> human approval
/dev-plan
    small immutable plans -> rich Pi plan brief -> human approval
/dev-build
    fresh visible Builder per approved plan/repair -> one commit each
/dev-prepare
    rebase + local final checks + push/update draft PR -> STOP
    CI + review bots run asynchronously
/dev-review                 # you invoke after external signals are terminal
    CI (red or green) + bot/PR feedback + adversarial review
    -> rich human review/repair brief
    -> PASS or human-approved narrow repair plans
/dev-build                  # only when repairs were approved
    ...
/dev-ship                   # only after exact HEAD has PASS review
    finalize concise PR description + mark ready for human review
```

There is no orchestrator agent, database, durable transcript, per-plan reviewer, hidden auto-repair loop, or backwards-compatibility layer. Git is implementation truth. The approved spec is semantic truth.

Workflow state is intentionally small and ignored by Git under `plans/<project>/`:

```text
spec.md
project.toon
progress.toon
plans/P001.toon
repairs/R001.toon     # only when review repairs are approved
review.toon
```

`progress.toon` is owned by the Pi build driver and contains only pointers such as completed IDs/current ID/accepted HEAD.

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
