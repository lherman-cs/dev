## Bootstrap

```sh
bash <(curl -L https://raw.githubusercontent.com/lherman-cs/dev/master/install.sh)
```

## Useful Commands

```
nix profile install . --name dev
nix profile upgrade dev
nix flake lock --update-input nixpkgs --update-input nix

## dev log

Constraints:

* Rows: 100k
* Process Time: <100ms
```

## LSP Configs
https://github.com/neovim/nvim-lspconfig/blob/master/CONFIG.md

Some issues with NVIM LSP:
* Kotlin LSP ignores hardcoded patterns, https://github.com/fwcd/kotlin-language-server/issues/464
  * workaround `ln -s build generated`

## Use a different ssh key for different projects

Edit ~/.ssh/config:

```
Host personal
    HostName github.com
    User git
    IdentityFile ~/.ssh/personal
    IdentitiesOnly yes
```

## Missing nerd symbols

https://webinstall.dev/nerdfont/

## Disable sleep on close lid (MAC)

`sudo pmset -a disablesleep 1`


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

## Mac 

### Dota 2 upgrade MoltenVK (Vulkan translation layer for Metal)

Download pre-compiled MoltenVK from https://github.com/KhronosGroup/MoltenVK/releases.

Then, copy the library to the following:

/Users/lukas/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/bin/osx64/libMoltenVK.dylib

### View GPU/CPU history

Go to activity monitor -> Window -> Gpu/Cpu history
