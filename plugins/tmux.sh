function install_tmux_linux-gnu() {
  sudo apt install -y tmux
}

function install_tmux_darwin() {
  brew install tmux
}

function install_tmux() {
  rm $HOME/.tmux.conf
  ln -s ${ROOT_DIR}/etc/.tmux.conf $HOME/.tmux.conf
}
