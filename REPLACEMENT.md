# Using this full source ZIP

This archive contains the complete `dev/` source tree based on `4946e2f47ffdb78572dbb4dc2175c3c3ab391d67`, with workflow maintenance applied. It is **not** a patch-only bundle. `ARCHIVE_MANIFEST.json` records every included file and the five intended removals.

Extract into a separate directory first. Keep a backup of your existing checkout and compare local changes before replacing its source files. The ZIP intentionally does not contain `.git`, private credentials, ignored `plans/`, build output or machine-local files. **Preserve your existing `.git` metadata, local plans and uncommitted work. Do not delete the original repository directory or use a blanket clean/reset.**

When copying over an existing checkout, include hidden source directories such as `dotfiles/.agents` and `dotfiles/.codex`. Remove only the obsolete source templates listed in `REMOVED_FILES.txt`, after backing up any local modifications to those exact files. Do not use a broad delete-sync: the source snapshot cannot know your untracked files. Extracting over old files alone will not remove retired templates.

Run `just test` locally before installing. It includes Python regression checks plus Rust tests/build and the compiled-launcher recording test. This delivery has passed the Python checks; Rust and live Codex/PulseBeam trials remain unrun here. See VALIDATION.md. No CI is needed.

After local validation, `just install` rebuilds the launcher with the new embedded assets. Optional `just install-workflow /path/to/worktree` exports only workflow assets and backs up known retired installed templates. Do not run install.sh for this update; that is the legacy whole-machine bootstrap.
