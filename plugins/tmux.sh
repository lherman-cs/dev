function install_tmux_linux-gnu() {
  sudo apt install -y tmux
}

function install_tmux_darwin() {
  brew install tmux
}

function install_tmux() {
  target=$HOME/.tmux.conf
  confirm ${target} && rm ${target}
  ln -s ${ROOT_DIR}/etc/.tmux.conf ${target}
}
