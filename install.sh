#!/bin/bash

BIN_DIR=/usr/local/bin
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

function install_nvim() {
	# Install NVIM package manager
	git clone https://github.com/wbthomason/packer.nvim ~/.local/share/nvim/site/pack/packer/start/packer.nvim

	mkdir -p $HOME/.config
	ln -s ${SCRIPT_DIR}/nvim $HOME/.config/nvim
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

function install_go() {
  GO111MODULE=on go get golang.org/x/tools/gopls@latest
}

function install_go_linux-gnu() {
  sudo snap install go --classic
}

function install_go_darwin() {
  brew install go
}

function install_rust() {
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  rustup update
  rustup component add rust-src 
  rustup +nightly component add rust-analyzer-preview

  sudo bash -c "cat > ${BIN_DIR}/rust-analyzer" <<EOF
#!/bin/bash

rustup run nightly rust-analyzer "\$@"
EOF

  sudo chmod +x ${BIN_DIR}/rust-analyzer
}

function install() {
  if command -v install_$1_${OSTYPE}; then
    install_$1_${OSTYPE}
  fi

  if command -v install_$1; then
    install_$1
  fi
}

install $1
