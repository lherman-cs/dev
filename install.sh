#!/bin/bash

# Exit immediately if a command exits with a non-zero status,
# treat unset variables as an error, and catch pipeline failures.
set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-$HOME/workspace}"
DEV_REPO_DIR="$WORKSPACE_DIR/dev"

# Helper for logging (Colors restored)
log() { echo -e "\033[1;32m==>\033[0m $1"; }
warn() { echo -e "\033[1;33mWarning:\033[0m $1"; }
error() { echo -e "\033[1;31mError:\033[0m $1" >&2; }

function append_shell() {
  local line="$1"
  if [[ "${SHELL:-}" == *"bash"* ]]; then
    local rc_file="$HOME/.bashrc"
  else
    local rc_file="$HOME/.zshrc"
  fi

  if ! grep -Fxq "$line" "$rc_file" 2>/dev/null; then
    echo "$line" >>"$rc_file"
    log "Added to $rc_file: $line"
  fi
}

# 1. Install Homebrew safely
if ! command -v brew &>/dev/null; then
  log "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [ -d "/home/linuxbrew/.linuxbrew" ]; then
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  elif [ -d "/opt/homebrew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  else
    eval "$("$HOME/.brew/bin/brew" shellenv)"
  fi
else
  log "Homebrew already installed."
fi

# 2. Install Packages
log "Installing packages via Homebrew..."
brew install \
  gcc wl-clipboard curl git git-lfs htop tmux \
  neovim fd fzf ripgrep jq yq go nodejs npm protobuf-c

# 3. Setup Workspace and Repository
mkdir -p "$WORKSPACE_DIR"

if [ -d "$DEV_REPO_DIR" ]; then
  log "Detected existing $DEV_REPO_DIR. Updating..."
  cd "$DEV_REPO_DIR"
  git pull origin master || warn "Git pull failed. Proceeding anyway."
else
  log "Cloning dev repository..."
  cd "$WORKSPACE_DIR"
  git clone https://github.com/lherman-cs/dev.git
fi

# Ensure we are in the right directory before proceeding
cd "$DEV_REPO_DIR"

# Allow changing the remote to fail gracefully if git isn't playing nice
log "Setting git remote URL to SSH..."
git remote set-url origin git@github.com:lherman-cs/dev.git || warn "Could not set git remote to SSH."

# 4. Install Rust
if ! command -v cargo &>/dev/null; then
  log "Installing Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # Source cargo env immediately so the current script can use 'cargo'
  if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
  fi
else
  log "Rust/Cargo already installed."
fi

# 5. Build and Link Dev Tools
log "Building local cargo package..."
# Explicitly add cargo to the temporary path just in case sourcing failed
export PATH="$HOME/.cargo/bin:$PATH"

if command -v cargo &>/dev/null; then
  # || true prevents a compilation error from killing the whole script
  cargo install --path . || error "Cargo install failed! Check compilation errors above."
else
  error "Cargo binary not found. Skipping build."
fi

log "Linking dotfiles..."
if command -v dev &>/dev/null; then
  dev link --from "$PWD/dotfiles" --force --real
else
  error "'dev' command not found in PATH. Skipping dotfile linking."
fi

append_shell "source '$HOME/.extend.rc'"

# 6. Install Nerd Fonts
if ! command -v webi &>/dev/null && [ ! -d "$HOME/.local/bin/nerdfont" ]; then
  log "Installing Nerd Fonts..."
  curl -sS https://webi.sh/nerdfont | sh
else
  log "Nerd fonts setup skipped (already exists)."
fi

log "Bootstrap complete!"
