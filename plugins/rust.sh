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
