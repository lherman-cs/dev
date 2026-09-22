#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-$HOME/workspace}"
DEV_REPO_DIR="$WORKSPACE_DIR/dev"

log() { printf '\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mWarning:\033[0m %s\n' "$1" >&2; }

append_shell() {
  local line="$1" rc_file
  if [[ "${SHELL:-}" == *bash* ]]; then rc_file="$HOME/.bashrc"; else rc_file="$HOME/.zshrc"; fi
  touch "$rc_file"
  grep -Fxq "$line" "$rc_file" || {
    printf '%s\n' "$line" >>"$rc_file"
    log "Added to $rc_file: $line"
  }
}

if ! command -v brew >/dev/null 2>&1; then
  log "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /home/linuxbrew/.linuxbrew/bin/brew ]]; then eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"; fi
  if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
fi

log "Installing base tools"
brew install gcc wl-clipboard curl git git-lfs htop tmux neovim fd fzf ripgrep jq yq gh go nodejs npm protobuf-c sccache


mkdir -p "$WORKSPACE_DIR"
if [[ -d "$DEV_REPO_DIR/.git" ]]; then
  log "Updating $DEV_REPO_DIR"
  git -C "$DEV_REPO_DIR" pull --ff-only origin main || warn "Could not fast-forward dev repo; using current checkout"
else
  log "Cloning dev repository"
  git clone https://github.com/lherman-cs/dev.git "$DEV_REPO_DIR"
fi
cd "$DEV_REPO_DIR"
git remote set-url origin git@github.com:lherman-cs/dev.git || true

if ! command -v cargo >/dev/null 2>&1; then
  log "Installing Rust"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
export PATH="$HOME/.cargo/bin:$PATH"

log "Installing dev command"
cargo install --path . --locked

log "Reconciling managed dotfiles and Pi config (preserving credentials)"
dev reconcile --from "$PWD/dotfiles" --apply
bash "$PWD/scripts/install-pi.sh"

append_shell "source '$HOME/.extend.rc'"

if ! command -v webi >/dev/null 2>&1 && [[ ! -d "$HOME/.local/bin/nerdfont" ]]; then
  log "Installing Nerd Fonts"
  curl -sS https://webi.sh/nerdfont | sh
fi

log "Done. Launch Pi phases with dev a spec|plan|build|ship; trigger with /dev-<phase>."
