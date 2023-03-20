[ -s "$HOME/.work.rc" ] && source $HOME/.work.rc

# Inject Nix environment by default
if [ -e $HOME/.nix-profile/etc/profile.d/nix.sh ]
then
	. $HOME/.nix-profile/etc/profile.d/nix.sh
fi

# Append this line to ~/.bashrc to enable fzf keybindings for Bash:
source ~/.nix-profile/share/fzf/key-bindings.bash

# Append this line to ~/.bashrc to enable fuzzy auto-completion for Bash:
source ~/.nix-profile/share/fzf/completion.bash

export PATH="/snap/bin:$PATH"
export PATH="$HOME/go/bin:$PATH"
export PATH="$HOME/bin:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$HOME/Applications:$PATH"
export GIT_EDITOR="nvim"

# Ubuntu Specific
export PATH="$PATH:$HOME/Android/Sdk/emulator"
export PATH="$PATH:$HOME/Android/Sdk/platform-tools"
export PATH=$PATH:/usr/local/go/bin
export PATH=$PATH:$HOME/.local/bin
export ANDROID_SDK_ROOT=$HOME/Android/Sdk


alias wcd="cd \$(dev ws path \$(dev ws ls ',' | sed 's/,/\n/g' | fzf))"
alias wf="echo \$(dev ws path \$(dev ws ls ',' | sed 's/,/\n/g' | fzf))"
alias v='nvim'
alias p='python3'
alias tasks="vim $HOME/tasks.txt"
alias fopen='xdg-open `fzf`'
alias fcat='cat `fzf`'
alias fless='cat `fzf`'
# Debug env setup
alias dap-go="dlv --headless=true --listen=:10001 --api-version=2 --log --log-output=dap exec"
export GOFLAGS="-gcflags=all=-N -gcflags=-l" # always include debug information
