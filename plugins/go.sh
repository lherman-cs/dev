function install_go() {
  GO111MODULE=on go get golang.org/x/tools/gopls@latest
}

function install_go_linux-gnu() {
  sudo snap install go --classic
}

function install_go_darwin() {
  brew install go
}

