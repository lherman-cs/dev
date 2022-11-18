# Workspace

## Commands

1. ws init: creates .workspace.toml
2. ws add <alias> <path to workspace>: add workspace mapping to .workspace.toml
4. ws rm <alias>: remove workspace mapping from .workspace.toml
3. ws status: run version control's status set on .workspace.toml on every workspace. Default to "git status"
4. ws path <workspace name>: get absolute path of workspace name
5. ws tidy: clean up invalid paths

## Out of Scope

* Repl is outside scope. Always use default shell, repl is just ugly... This means we can't change directories, instead we can do `cd $(dev ws path workspace1)`
