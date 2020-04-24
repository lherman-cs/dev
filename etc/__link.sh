#!/bin/bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd ${ROOT_DIR}
FILES=$(find . -type f ! -name "__*")

for file in ${FILES[@]}; do
  mkdir -p $(dirname "$file")
  src="${ROOT_DIR}/${file}"
  target="${HOME}/${file}"
  if ! [ -f "$target" ]; then
    ln -s "$src" "$target"
    echo "linked ${src} to ${target}"
  fi
done
