#!/bin/bash
# Install nix package manager
sh <(curl -L https://nixos.org/nix/install) --yes

# Install deps to nix
nix-env -iA \
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
