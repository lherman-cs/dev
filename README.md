# dev toolbox

Personal development toolbox plus an OMP-native engineering workflow.

## Workflow

The public UX is symmetric:

```text
dev a spec [prompt...]
dev a plan [prompt...]
dev a build [prompt...]
dev a prepare [prompt...]
dev a review [prompt...]
dev a ship [prompt...]
dev a resume [session]
```

A bare phase launch selects that phase's configured model/thinking and opens OMP interactively with **no synthetic user turn**. Inside the session, trigger the phase with the matching slash command:

```text
dev a spec
> /dev-spec design reconnect semantics

dev a build
> /dev-build my-project
```

When a prompt is supplied to the CLI, the launcher submits the same slash command immediately:

```text
dev a spec "design reconnect semantics"
# equivalent startup action: /dev-spec design reconnect semantics

dev a ship my-project
# equivalent startup action: /dev-ship my-project
```

The six phase roles are explicit:

| Phase | Model / thinking |
| --- | --- |
| Spec | Sol medium |
| Plan | Sol high |
| Build | Sol low |
| Prepare | Luna medium |
| Review | Astra low |
| Ship | Luna medium |

Build retry uses Sol medium. Bundled `scout` uses Luna medium.

`/dev-spec` and `/dev-plan` are thin friendly aliases for OMP's native `dev-spec` and `dev-plan` skills in the **current session**. They do not spawn another Specifier/Planner. Build/Prepare/Review/Ship are deterministic extension commands.

The core invariant is:

> **Code decides workflow; models decide engineering.**

## Configuration

This repository never owns or overwrites:

```text
~/.omp/agent/config.yml
```

Workflow defaults are installed separately at:

```text
~/.omp/agent/dev-workflow.yml
```

Both `dev a` and isolated workflow workers pass the workflow file as an OMP `--config` overlay.

## Workflow state

Durable state lives under `plans/<project>/`. The extension automatically adds `/plans/` to the repository-local `.git/info/exclude` if needed, so the repository's `.gitignore` does not need to change.

If the repository already tracks files under `plans/`, the workflow stops because that is a real namespace collision.

See [WORKFLOW.md](WORKFLOW.md) for the detailed contracts.

## Bootstrap

```sh
bash <(curl -L https://raw.githubusercontent.com/lherman-cs/dev/main/install.sh)
```

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
