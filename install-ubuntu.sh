#!/bin/bash

#TODO WIP
WORKSPACE_DIR=$HOME/workspace
DEV_REPO_DIR=$WORKSPACE_DIR/dev

function append_shell() {
	if [[ $SHELL == *"bash"* ]]; then
		echo "$1" >>~/.bashrc
	else
		echo "$1" >>~/.zshrc
	fi
}

# Install deps

sudo apt update && sudo apt install -y git fzf ripgrep

sudo snap install --classic \
	curl \
        htop \
        tmux \
        gh \
        nvim \
        fd
        yq
        go
        nodejs


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

go run . link -from $PWD/dotfiles -force -real
append_shell "source '$HOME/.extend.rc'"
go install

# Install nerd fonts
curl -sS https://webi.sh/nerdfont | sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
