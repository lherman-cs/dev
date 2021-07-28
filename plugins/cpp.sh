function install_cpp_linux-gnu() {
  sudo apt install g++ gcc
  sudo snap install ccls --classic
}

function install_cpp_darwin() {
  brew install ccls gcc
}
