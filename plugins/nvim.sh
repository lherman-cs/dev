function install_nvim() {
	# Install NVIM package manager
	git clone https://github.com/wbthomason/packer.nvim ~/.local/share/nvim/site/pack/packer/start/packer.nvim

	mkdir -p $HOME/.config
  target=${HOME}/.config/nvim
	confirm ${target} rm -rf ${target}
  ln -s ${ROOT_DIR}/nvim ${target}
  nvim -c 'PackerUpdate'
}

function install_nvim_linux-gnu() {
	bin_path=${BIN_DIR}/nvim
	sudo curl -L --output ${bin_path} https://github.com/neovim/neovim/releases/download/v0.6.0/nvim.appimage
	sudo chmod +x ${bin_path}

	sudo snap install --classic ripgrep
  # Enable clipboard
  sudo apt install -y wl-clipboard
}

function install_nvim_darwin() {
	brew install neovim ripgrep
}

