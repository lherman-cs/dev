# dev toolbox

Personal development toolbox plus a small OMP-native engineering workflow.

## Workflow

Interactive specification/planning use the tiny `dev a` role launcher:

```text
dev a spec
dev a spec "describe the requested behavior"
dev a plan
dev a plan "plan the approved project"
dev a resume
```

A bare `dev a spec` / `dev a plan` only launches OMP with the workflow role selected. Supplying a prompt launches the same role and submits OMP's native `/skill:dev-spec` / `/skill:dev-plan` command as the initial turn. `dev a resume [session]` reapplies only the workflow overlay and resumes the existing OMP session.

Automated phases remain deterministic extension commands:

```text
/dev-build
/dev-prepare
/dev-review
/dev-ship
```

The invariant is:

> **Code decides workflow; models decide engineering.**

The extension owns dependency ordering, retries, recovery, exact-commit validation, Git/GitHub sequencing, CI waiting, repair convergence, and exact-candidate approval. Builders and Reviewers are fresh isolated OMP workers. There is no foreground orchestrator model relaying workflow phases.

OMP owns the harness capabilities: model runtime, skills, `task`/bundled `scout`, Agent Hub, LSP/GitHub/browser/web tooling, Markdown/Mermaid, and native dialogs.

## Configuration

`install.sh` does **not** own or overwrite `~/.omp/agent/config.yml`.

Workflow-specific defaults are installed at:

```text
~/.omp/agent/dev-workflow.yml
```

Optional personal workflow overrides belong in:

```text
~/.omp/agent/dev-workflow.local.yml
```

The local file is never managed by this repository. OMP receives the defaults overlay first and the local overlay second.

Workflow state lives under ignored `plans/<project>/`. The driver automatically adds `/plans/` to the repository's local `.git/info/exclude` when needed; it does not require or edit the repository's `.gitignore`. It stops only if the repository already tracks files under `plans/`, which is a real namespace collision.

See [WORKFLOW.md](WORKFLOW.md) for the contracts.

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
