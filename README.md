## Bootstrap

```sh
bash <(curl -L https://raw.githubusercontent.com/lherman-cs/dev/master/install.sh)
```

## LSP Configs
https://github.com/neovim/nvim-lspconfig/blob/master/CONFIG.md


## Missing nerd symbols

### Ubuntu

1.) Download a Nerd Font, https://www.nerdfonts.com/font-downloads. Specifically "Ubuntu Nerd Font"

2.) Unzip and copy to ~/.fonts

3.) Run the command fc-cache -fv to manually rebuild the font cache

### Mac

```
brew tap homebrew/cask-fonts
brew install --cask font-jetbrains-mono-nerd-font
```


## Turn on DND on Gnome

` gsettings set org.gnome.desktop.notifications show-banners false`

## Install alacritty

```bash
cargo install alacritty
sudo mv ~/.cargo/bin/alacritty /usr/bin/alacritty
gsettings set org.gnome.desktop.default-applications.terminal exec /usr/bin/alacritty
gsettings set org.gnome.desktop.default-applications.terminal exec-arg "--working-directory"
```

## Toggle text mode

Text mode: `sudo systemctl isolate multi-user.target`

Graphical mode: `sudo systemctl isolate graphical.target`


## Prevent sleep on close lid

Disable sleep: `systemctl mask sleep.target suspend.target`

Enable sleep: `systemctl unmask sleep.target suspend.target`

## Better system media pipeline handling

https://pipewire-debian.github.io/pipewire-debian/

## Network usage monitor

https://linuxhint.com/monitor-network-traffic-with-vnstat-on-ubuntu-20-04/

## How to configure logitech devices on Ubuntu

https://launchpad.net/~solaar-unifying/+archive/ubuntu/stable

## USB-C Display Not Working

https://askubuntu.com/questions/1105332/external-monitor-not-working-ubuntu-nvidia/1134579#1134579

## Orange pi 5

### Firefox is not using hardware acceleration

```
MOZ_DISABLE_RDD_SANDBOX=1 firefox-esr
```

### Chromium is not using hardware acceleration

https://forum.armbian.com/topic/25957-guide-kodi-on-orange-pi-5-with-gpu-hardware-acceleration-and-hdmi-audio/page/2/
```
CHROMIUM_FLAGS="--use-gl=egl" chromium-browser
```

The environment variable is needed to tell firefox to bypass the security check, so it can use the system's ffmpeg.
https://forum.radxa.com/t/archlinux-on-rock5b/13851

Updating firefox to the latest version without snap on Ubuntu 22.04 improves webgl, https://www.omgubuntu.co.uk/2022/04/how-to-install-firefox-deb-apt-ubuntu-22-04
