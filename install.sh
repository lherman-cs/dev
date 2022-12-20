#!/bin/bash

WORKSPACE_DIR=$HOME/workspace


# Install nix package manager
sh <(curl -L https://nixos.org/nix/install) --yes

# Load nix environment right away
if ! command -v nix-env &> /dev/null
then
	. $HOME/.nix-profile/etc/profile.d/nix.sh
fi


# Install deps to nix
nix-env -iA \
	nixpkgs.git \
	nixpkgs.gcc \
	nixpkgs.fish \
	nixpkgs.xclip \
	nixpkgs.go \
	nixpkgs.rustup \
	nixpkgs.nodejs \
	nixpkgs.htop \
	nixpkgs.neovim \
	nixpkgs.tmux \
	nixpkgs.stow \
	nixpkgs.curl \
	nixpkgs.ripgrep

mkdir -p $WORKSPACE_DIR
cd $WORKSPACE_DIR
git clone https://github.com/lherman-cs/dev.git
cd dev/dotfiles
stow --target=$HOME --verbose --restow */
