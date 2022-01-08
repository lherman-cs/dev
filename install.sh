#!/bin/bash

BIN_DIR=/usr/local/bin
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

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
  for file in ${FILES[@]}; do
    src="${ROOT_DIR}/${file}"
    target="${HOME}/${file}"
    mkdir -p $(dirname "$target")
    if ! [ -f "$target" ]; then
      ln -s "$src" "$target"
      echo "linked ${src} to ${target}"
    fi
  done
}

sudo apt install -y \
  gcc \
  g++ \
  wl-clipboard

sudo snap install --classic \
  go \
  node \
  tmux \
  zsh \
  ripgrep \
  nvim \
  htop

# Install rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
