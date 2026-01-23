#!/bin/bash

WORKSPACE_DIR=$HOME/workspace
DEV_REPO_DIR=$WORKSPACE_DIR/dev

function append_shell() {
  if [[ $SHELL == *"bash"* ]]; then
    echo "$1" >>~/.bashrc
  else
    echo "$1" >>~/.zshrc
  fi
}

# /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# eval $(home/linuxbrew/.linuxbrew/bin/brew shellenv bash)

brew install \
  clipboard \
  curl \
  git \
  git-lfs \
  htop \
  tmux \
  neovim \
  fd \
  fzf \
  ripgrep \
  jq \
  yq \
  go \
  nodejs \
  npm

mkdir -p $WORKSPACE_DIR

if [ -d "$DEV_REPO_DIR" ]; then
  echo "Detected existing $DEV_REPO_DIR. Update the repo instead."
  cd $DEV_REPO_DIR
  git pull origin master
else
  cd $WORKSPACE_DIR
  git clone https://github.com/lherman-cs/dev.git
fi

cd $DEV_REPO_DIR
git remote set-url origin git@github.com:lherman-cs/dev.git

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --path .
dev link --from $PWD/dotfiles --force --real
append_shell "source '$HOME/.extend.rc'"

# Install nerd fonts
# curl -sS https://webi.sh/nerdfont | sh
# sudo dnf install -y wl-clipboard
