function install_zsh_linux-gnu() {
  sudo apt install -y zsh
}

function install_zsh_darwin() {
  brew install zsh
}

function install_zsh() {
  sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
  rm ${HOME}/.zshrc
  ln -s ${ROOT_DIR}/etc/.zshrc ${HOME}/.zshrc
}
