#!/bin/bash

WORKSPACE_DIR=$HOME/workspace
DEV_REPO_DIR=$WORKSPACE_DIR/dev

# Install nix package manager
sh <(curl -L https://nixos.org/nix/install) --yes

# Load nix environment right away
if ! command -v nix-env &> /dev/null
then
	. $HOME/.nix-profile/etc/profile.d/nix.sh
fi


# Install deps to nix
nix-channel --update
nix-env -iA \
	nixpkgs.git \
	nixpkgs.gcc \
	nixpkgs.zsh \
	nixpkgs.antibody \
	nixpkgs.xclip \
	nixpkgs.go \
	nixpkgs.rustup \
	nixpkgs.nodejs \
	nixpkgs.htop \
	nixpkgs.neovim \
	nixpkgs.tmux \
	nixpkgs.stow \
	nixpkgs.curl \
	nixpkgs.fzf \
	nixpkgs.ripgrep

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
go install

cd $DEV_REPO_DIR/dotfiles
stow --target=$HOME --verbose --restow */

# Install zsh
command -v zsh | sudo tee -a /etc/shells
sudo chsh -s $(which zsh) $USER

antibody bundle < ~/.zsh_plugins.txt > ~/.zsh_plugins.sh
