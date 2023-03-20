. "$HOME/.cargo/env"

if [ -e $HOME/.nix-profile/etc/profile.d/nix.sh ]; then . $HOME/.nix-profile/etc/profile.d/nix.sh; fi # added by Nix installer

export LOCALE_ARCHIVE=/usr/lib/locale/locale-archive


if [ -e /home/lukas/.nix-profile/etc/profile.d/nix.sh ]; then . /home/lukas/.nix-profile/etc/profile.d/nix.sh; fi # added by Nix installer
