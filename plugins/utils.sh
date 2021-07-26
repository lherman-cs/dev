function install_utils_linux-gnu() {
  sudo apt install -y git curl
}

function install_utils_darwin() {
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  brew install git curl
}
