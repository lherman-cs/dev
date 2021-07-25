#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

function install_deps() {
	if [[ "$OSTYPE" == "linux-gnu"* ]]; then
		bin_path=/usr/local/bin/nvim
		sudo curl -L --output ${bin_path} https://github.com/neovim/neovim/releases/download/v0.5.0/nvim.appimage
		sudo chmod +x ${bin_path}

		sudo snap install --classic ripgrep
	elif [[ "$OSTYPE" == "darwin"* ]]; then
		brew install neovim ripgrep
	else 
		echo "Unsupported platform"
		exit 1
	fi
}

install_deps

# Install NVIM package manager
git clone https://github.com/wbthomason/packer.nvim ~/.local/share/nvim/site/pack/packer/start/packer.nvim

mkdir -p $HOME/.config
ln -s ${SCRIPT_DIR}/nvim $HOME/.config/nvim
