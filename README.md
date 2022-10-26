## Bootstrap

```sh
./install.sh bootstrap
```

## LSP Configs
https://github.com/neovim/nvim-lspconfig/blob/master/CONFIG.md


## Missing nerd symbols

1.) Download a Nerd Font

2.) Unzip and copy to ~/.fonts

3.) Run the command fc-cache -fv to manually rebuild the font cache


## Turn on DND on Gnome

` gsettings set org.gnome.desktop.notifications show-banners false`

## Install alacritty

```bash
cargo install alacritty
sudo mv ~/.cargo/bin/alacritty /usr/bin/alacritty
gsettings set org.gnome.desktop.default-applications.terminal exec /usr/bin/alacritty
gsettings set org.gnome.desktop.default-applications.terminal exec-arg "--working-directory"
```

