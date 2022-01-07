SHELL := /bin/bash
APT_ITEMS = 
SNAP_ITEMS = 

confirm = ./scripts/confirm

.PHONY: install
install: cpp
	$(SUDO) apt install $(APT_ITEMS)
	$(SUDO) snap install --classic $(SNAP_ITEMS)

cpp: 
	$(eval APT_ITEMS += gcc g++)
	$(eval SNAP_ITEMS += ccls)

go:
	$(eval SNAP_ITEMS += go)

node:
	$(eval SNAP_ITEMS += node)

rust:
	curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

tmux:
	$(eval SNAP_ITEMS += tmux)

zsh:
	$(eval SNAP_ITEMS += zsh)

ripgrep:
	$(eval SNAP_ITEMS += ripgrep)

nvim:
	$(eval SNAP_ITEMS += nvim)

	# Enable clipboard
	$(eval APT_ITEMS += wl-clipboard)

dotfiles: $(HOME)/.zshrc $(HOME)/.tmux.conf $(HOME)/.config/nvim

$(HOME)/.zshrc: etc/.zshrc
	ln -s $@ $^

$(HOME)/.tmux.conf: etc/.tmux.conf
	ln -s $@ $^

$(HOME)/.config/nvim: nvim
	mkdir -p $(dir $@)
	ln -s $@ $^
