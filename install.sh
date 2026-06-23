#!/bin/bash

# Exit immediately if a command exits with a non-zero status,
# treat unset variables as an error, and catch pipeline failures.
set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-$HOME/workspace}"
DEV_REPO_DIR="$WORKSPACE_DIR/dev"

# Helper for logging (No colors)
log() { echo "==> $1"; }
error() { echo "Error: $1" >&2; }

function append_shell() {
    local line="$1"
    # Detect shell based on parent process if $SHELL isn't reliable, 
    # but fallback to standard rc files.
    if [[ "${SHELL:-}" == *"bash"* ]]; then
        local rc_file="$HOME/.bashrc"
    else
        local rc_file="$HOME/.zshrc"
    fi

    # Avoid duplicating the line if the script is run multiple times
    if ! grep -Fxq "$line" "$rc_file" 2>/dev/null; then
        echo "$line" >> "$rc_file"
        log "Added to $rc_file: $line"
    fi
}

# 1. Install Homebrew safely
if ! command -v brew &>/dev/null; then
    log "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Dynamically locate brew env instead of hardcoding linuxbrew path
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
    neovim fd fzf ripgrep jq yq go nodejs npm

# 3. Setup Workspace and Repository
mkdir -p "$WORKSPACE_DIR"

if [ -d "$DEV_REPO_DIR" ]; then
    log "Detected existing $DEV_REPO_DIR. Updating..."
    cd "$DEV_REPO_DIR"
    git pull origin master
else
    log "Cloning dev repository..."
    cd "$WORKSPACE_DIR"
    # Using HTTPS for initial clone in case SSH keys aren't set up yet
    git clone https://github.com/lherman-cs/dev.git
fi

# Ensure we are in the right directory before proceeding
cd "$DEV_REPO_DIR"

# Switch to SSH URL for future pushes (will fail gracefully later if keys aren't set up yet)
git remote set-url origin git@github.com:lherman-cs/dev.git

# 4. Install Rust
if ! command -v cargo &>/dev/null; then
    log "Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # Source cargo env immediately so the current script can use 'cargo'
    source "$HOME/.cargo/env"
else
    log "Rust/Cargo already installed."
fi

# 5. Build and Link Dev Tools
log "Building local cargo package..."
cargo install --path .

log "Linking dotfiles..."
# Ensure the 'dev' binary built by cargo is accessible
export PATH="$HOME/.cargo/bin:$PATH"
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
