# dev toolbox

## Codex development workflow

Five public skills with bounded context and stable review gates: `dev-spec`, `dev-plan`, `dev-build`, `dev-review`, `dev-project`.

```text
approved spec → decision-complete plan → Builder → one fresh Reviewer
                                             ↖ bounded repair ↙
all tasks accepted → integrated validation → one fresh final review
```

The controller coordinates; it does not become another engineer or reviewer. One Reviewer persona always covers requirements and engineering quality. Task-local Builders stay warm only through their own bounded repairs; reviewers are fresh. Factual Explorer is a read-only leaf, not a sixth public skill. Capability aliases reuse existing Builder/Reviewer personas.

```sh
# Human-facing semantic alignment
dev a s "Define the behavior we need and align with me first."
# After explicit spec approval: autonomous planning and gated execution.
dev a pr "Execute plans/example/."
```

Task briefs, exact Git diffs and reports are file-based. Machine-checked review provenance binds the mode, candidate, base and immutable contract. One packet carries all blocking findings without controller paraphrasing. One ordinary repair is followed only by a justified exceptional attempt; no blind three-round loop or real-blocker waiver.

Artifacts live only in `./plans/<project>/{spec.md,plan.md,progress.md,work/}` and are Git-ignored. Preserve incomplete work; delete `work/` only after successful completion. The workflow never pushes, merges, rebases or manages worktrees.

Model/effort policy lives only in `dotfiles/.codex/agents/*.toml`. The configured defaults are a starting experiment, not a measured optimum. See [WORKFLOW.md](WORKFLOW.md), [requirements](skill-requirements.md), [decisions](workflow-questionnaire.md), [SOURCES.md](SOURCES.md), [EVALS.md](EVALS.md) and [VALIDATION.md](VALIDATION.md).

### Local checks — no CI

```sh
python3 -m pip install -r tests/requirements.txt
just test-fast  # asset wiring and Python/Git/filesystem regression tests
just test-slow  # Rust tests/build and compiled launcher with a Codex recording shim
just test       # both; `just check` remains an alias
```

No GitHub Actions, hosted qualification or automatic paid model evaluations are added. Live behavioral claims require separate explicit trials.

### Install

```sh
just install  # rebuild/install the binary and its embedded workflow snapshot
python3 scripts/install_workflow.py /path/to/worktree --dry-run
just install-workflow /path/to/worktree  # optional export of workflow assets only
```

The exporter preserves unrelated roles/skills and `.codex/config.toml`, and backs up changed assets and retired split-review prompts. It does not rewrite active project evidence or delete old runtime caches. See WORKFLOW.md for in-flight report/counter migration. Do not run the legacy machine bootstrap for this workflow-only update.

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

