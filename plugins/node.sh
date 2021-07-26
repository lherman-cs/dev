function install_node() {
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
  nvm use 14
  npm install -g typescript typescript-language-server yarn
}
