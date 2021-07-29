#!/bin/bash

BIN_DIR=/usr/local/bin
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PLUGINS_DIR=${ROOT_DIR}/plugins

function confirm() {
  if ! [ -f "$1" ]; then
    return 0
  fi

  read -p "Are you sure to overwrite $1? " -r
  echo    # (optional) move to a new line
  if [[ ! $REPLY =~ ^[Yy]$ ]]
  then
    return 1
  fi

  return 0
}

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
