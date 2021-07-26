#!/bin/bash

BIN_DIR=/usr/local/bin
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PLUGINS_DIR=${ROOT_DIR}/plugins

function install() {
  if command -v install_$1_${OSTYPE}; then
    install_$1_${OSTYPE}
  fi
  
  if command -v install_$1; then
    install_$1
  fi
}

for plugin in ${PLUGINS_DIR}/*
do 
  source $plugin
done

install $1
