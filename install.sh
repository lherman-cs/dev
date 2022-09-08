#!/bin/bash

HOME_DIR=home

function confirm() {
  if ! [ -f "$1" ]; then
    return 0
  fi

  read -p "Are you sure to overwrite $1? " -r
  echo    # (optional) move to a new line
  if [[ ! $REPLY =~ ^[Yy]$ ]]
  then
    return 1
  fi

  return 0
}

function link() {
  files=$(find ${HOME_DIR} -type f)
  for file in ${files[@]}; do
    src="${PWD}/${file}"
    target="${HOME}/${file#$HOME_DIR/}"

    mkdir -p $(dirname "$target")
    confirm "$target" && rm -rf "$target" && ln -s "$src" "$target"
  done
}

cd "$(dirname "${BASH_SOURCE[0]}")"

sudo apt install -y \
  gcc \
  g++ \
  zsh \
  wl-clipboard \
  fd-find \
  python3-venv

snaps=(
  go
  node
  tmux
  nvim
  htop
  curl
)

for snap in ${snaps[@]}
do
  sudo snap install --classic ${snap}
done

# Install rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install zsh awesome
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

cargo install ripgrep

link
