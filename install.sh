#!/bin/bash

WORKSPACE_DIR=$HOME/workspace
DEV_REPO_DIR=$WORKSPACE_DIR/dev

## Install nix package manager
#sh <(curl -L https://nixos.org/nix/install) --yes
#
## Load nix environment right away
#if ! command -v nix-env &> /dev/null
#then
#	. $HOME/.nix-profile/etc/profile.d/nix.sh
#fi
#
#
## Install deps to nix
#nix-channel --update
#nix-env -iA \
#	nixpkgs.git \
#	nixpkgs.xclip \
#	nixpkgs.htop \
#	nixpkgs.neovim \
#	nixpkgs.tmux \
#	nixpkgs.stow \
#	nixpkgs.curl \
#	nixpkgs.fzf \
#	nixpkgs.fd \
#	nixpkgs.ripgrep \
#	nixpkgs.go
#
function append_shell() {
	if [ "$SHELL" = "bash" ]; then
		echo "$1" >> ~/.bashrc
	else
		echo "$1" >> ~/.zshrc
	fi
}

append_shell 'export PATH=$PATH:/opt/homebrew/bin'

PACKAGES=(\
	git \
	htop \
	neovim \
	tmux \
	stow \
	curl \
	fzf \
	ripgrep \
	go \
)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
	sudo apt update && sudo apt install -y ${PACKAGES[*]}
elif [[ "$OSTYPE" == "darwin"* ]]; then
	/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
	append_shell 'export PATH=$PATH:/opt/homebrew/bin'
	export PATH=$PATH:/opt/homebrew/bin
	brew install ${PACKAGES[*]}
else
        # Unknown.
	echo "Unknown OSTYPE: $OSTYPE"
	exit 1
fi

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

cd $DEV_REPO_DIR/dotfiles
stow --target=$HOME --verbose --restow --no-folding */
append_shell "source '$HOME/.extend.rc'"

# curl -sf https://gobinaries.com/lherman-cs/dev | sh
go install .
