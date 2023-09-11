#!/bin/bash

WORKSPACE_DIR=$HOME/workspace
DEV_REPO_DIR=$WORKSPACE_DIR/dev

# Install nix package manager
sh <(curl -L https://nixos.org/nix/install) --yes

function append_shell() {
	if [ "$SHELL" = "bash" ]; then
		echo "$1" >>~/.bashrc
	else
		echo "$1" >>~/.zshrc
	fi
}

append_shell 'export PATH=$PATH:/opt/homebrew/bin'

PACKAGES=(
	git
	htop
	neovim
	tmux
	stow
	curl
	fzf
	ripgrep
	go
	fd
	just
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
# go install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --path .
LUA_LINK=static cargo build --release --lib
cp ./target/release/*.dylib ~/.config/nvim/lua/api/ws.so
cp ./target/release/*.so ~/.config/nvim/lua/api/ws.so
