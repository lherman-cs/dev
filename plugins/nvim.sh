function install_nvim() {
	# Install NVIM package manager
	git clone https://github.com/wbthomason/packer.nvim ~/.local/share/nvim/site/pack/packer/start/packer.nvim

	mkdir -p $HOME/.config
	rm -rf ${HOME}/.config/nvim 
  ln -s ${ROOT_DIR}/nvim $HOME/.config/nvim
}

function install_nvim_linux-gnu() {
	bin_path=${BIN_DIR}/nvim
	sudo curl -L --output ${bin_path} https://github.com/neovim/neovim/releases/download/v0.5.0/nvim.appimage
	sudo chmod +x ${bin_path}

	sudo snap install --classic ripgrep
}

function install_nvim_darwin() {
	brew install neovim ripgrep
}

