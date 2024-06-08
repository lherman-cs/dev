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

# Install nix package manager
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix |
	sh -s -- install --no-confirm --no-modify-profile
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

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
nix profile install .
go install

dev link -from $PWD/dotfiles -force
append_shell "source '$HOME/.extend.rc'"

# Install nerd fonts
curl -sS https://webi.sh/nerdfont | sh
