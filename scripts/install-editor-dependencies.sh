#!/bin/bash

dnf install -y \
  neovim \
  python3-neovim \
  fzf \
  ripgrep

# Install vim-plug
curl -fLo ~/.local/share/nvim/site/autoload/plug.vim --create-dirs \
    https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
