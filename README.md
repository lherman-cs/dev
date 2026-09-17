# dev toolbox


## Codex development workflow

Five public skills: `dev-spec`, `dev-plan`, `dev-build`, `dev-review`, `dev-project`. The human-approved `spec.md` is the semantic authority; a native Rust middleware, `dev workflow`, owns all operational state and transitions in a versioned SQLite database under Git metadata.

```text
approved spec -> Planner compiles queue -> Builder -> one fresh Reviewer -> accepted
                                         ^            |
                                         | one repair |
all tasks accepted -> integrated validation -> one fresh final review
```

Agents never maintain plan/progress/report state files. Planner, Builder and Reviewer interact through narrow `dev workflow` commands; the Luna controller normally does only `next -> dispatch -> wait -> next`. Candidate SHAs, verification, findings, repair/replan ceilings and recovery are enforced by code rather than controller prose.

```sh
# Human semantic alignment
dev a s "Define the behavior and align with me first."
# Once spec.md is explicitly APPROVED
dev workflow init --spec plans/example/spec.md
dev a pr "Execute the approved workflow."
# Inspect the deterministic control plane directly
dev workflow status
dev workflow next
```

The ordinary task path has no human gate after planning. One repair is allowed; residual blockers, repeated invalid tool use, a second verification failure, or a second material replan stop precisely rather than loop. Human pause/resume, semantic answers and deliberate HEAD adoption are first-class transitions.

Model/effort policy remains only in `dotfiles/.codex/agents/*.toml`; this redesign does not change those selections. See [WORKFLOW.md](WORKFLOW.md), [requirements](skill-requirements.md), and [decisions](workflow-questionnaire.md).

### Local checks — no CI

```sh
python3 -m pip install -r tests/requirements.txt
just test-fast
just test-slow
just test
```

### Install

```sh
just install
python3 scripts/install_workflow.py /path/to/worktree --dry-run
just install-workflow /path/to/worktree
```

The optional workflow exporter backs up replaced workflow assets and removes the retired prompt/script runtime. The actual workflow state is owned by `dev workflow`, not by exported Python helpers.

---

## Bootstrap

```sh
bash <(curl -L https://raw.githubusercontent.com/lherman-cs/dev/main/install.sh)
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

## Move nix to external
https://discourse.nixos.org/t/how-to-move-nix-store-to-external-drive-on-macos/19592/3
```

## LSP Configs

<https://github.com/neovim/nvim-lspconfig/blob/main/CONFIG.md>

Some issues with NVIM LSP:

- Kotlin LSP ignores hardcoded patterns, <https://github.com/fwcd/kotlin-language-server/issues/464>
  - workaround `ln -s build generated`

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

<https://webinstall.dev/nerdfont/>

## Disable sleep on close lid (MAC)

`sudo pmset -a disablesleep 1`

## Turn on DND on Gnome

`gsettings set org.gnome.desktop.notifications show-banners false`

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

<https://pipewire-debian.github.io/pipewire-debian/>

## Network usage monitor

<https://linuxhint.com/monitor-network-traffic-with-vnstat-on-ubuntu-20-04/>

## How to configure logitech devices on Ubuntu

<https://launchpad.net/~solaar-unifying/+archive/ubuntu/stable>

## USB-C Display Not Working

<https://askubuntu.com/questions/1105332/external-monitor-not-working-ubuntu-nvidia/1134579#1134579>

## Orange pi 5

### Firefox is not using hardware acceleration

```
MOZ_DISABLE_RDD_SANDBOX=1 firefox-esr
```

### Chromium is not using hardware acceleration

<https://forum.armbian.com/topic/25957-guide-kodi-on-orange-pi-5-with-gpu-hardware-acceleration-and-hdmi-audio/page/2/>

```
CHROMIUM_FLAGS="--use-gl=egl" chromium-browser
```

The environment variable is needed to tell firefox to bypass the security check, so it can use the system's ffmpeg.
<https://forum.radxa.com/t/archlinux-on-rock5b/13851>

Updating firefox to the latest version without snap on Ubuntu 22.04 improves webgl, <https://www.omgubuntu.co.uk/2022/04/how-to-install-firefox-deb-apt-ubuntu-22-04>

## Mac

### Dota 2 upgrade MoltenVK (Vulkan translation layer for Metal)

Download pre-compiled MoltenVK from <https://github.com/KhronosGroup/MoltenVK/releases>.

Then, copy the library to the following:

/Users/lukas/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/bin/osx64/libMoltenVK.dylib

### View GPU/CPU history

Go to activity monitor -> Window -> Gpu/Cpu history

### Set Static IP with a direct ethernet

vim /etc/systemd/network/10-static-mac.network

```
[Match]
Name=enx00e04ce20cdf

[Network]
Address=192.168.4.1/24
ConfigureWithoutCarrier=yes
```

```
sudo networkctl reload
sudo networkctl reconfigure enx00e04ce20cdf
ip addr show enx00e04ce20cdf
```

or  with NetworkManager

```
sudo nmcli device modify enp0s13f0u2u1u3 ipv4.method manual ipv4.addresses 192.168.4.1/24
```

### Headless Mode

**Prohibit from going asleep after closing the lid**

`sudo vim /etc/systemd/logind.conf`

```
[Login]
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
```

`sudo systemctl restart systemd-logind`

**Default to headless mode**

sudo systemctl set-default multi-user.target

**Temporary gui mode**

sudo systemctl isolate graphical.target

**Temporari headless mode**
sudo systemctl isolate multi-user.target

### Bypassing MAC xprotectd

Mac by default will limit using more than 1 CPU. To bypass this, we need to flag these binaries as developer tools

**Whitelist iTerm & `tmux`**

1. Run `open /opt/homebrew/bin/` to view the `tmux` binary in Finder.
2. Go to **System Settings > Privacy & Security > Developer Tools**.
3. Click **`+`** and drag **`tmux`** from Finder into the list.
4. Ensure both **iTerm** and **tmux** are toggled **ON**.
5. Restart the server to apply permissions:

```bash
tmux kill-server
```
