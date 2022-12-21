HISTFILE=~/.zsh_history
HISTSIZE=10000  # Save most-recent 1000 lines
SAVEHIST=10000  # Save most-recent 1000 lines

bindkey -v
bindkey '^R' history-incremental-search-backward


# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
# if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
#   source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
# fi

alias ..="cd .."
alias ...="cd ../.."
alias ....="cd ../../.."
alias .....="cd ../../../.."
alias mark="pwd > ~/.sd"
alias port='cd $(cat ~/.sd)'
alias vim='nvim'
alias vi='vim'
alias v='vim'
alias p='python3'
alias tasks="vim $HOME/tasks.txt"
alias fopen='xdg-open `fzf`'
alias fcat='cat `fzf`'
alias fless='cat `fzf`'

export PATH="/snap/bin:$PATH"
export PATH="$HOME/go/bin:$PATH"
export PATH="$HOME/bin:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$HOME/Applications:$PATH"
export EDITOR="nvim"
export GIT_EDITOR="nvim"

# Ubuntu Specific
export PATH="$PATH:$HOME/Android/Sdk/emulator"
export PATH="$PATH:$HOME/Android/Sdk/platform-tools"
export PATH=$PATH:/usr/local/go/bin
export PATH=$PATH:$HOME/.local/bin
export ANDROID_SDK_ROOT=$HOME/Android/Sdk

export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # This loads nvm

# 10ms for key sequences
export KEYTIMEOUT=1
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
# export TERM=xterm

[ -s "$HOME/.work.rc" ] && source $HOME/.work.rc


export PATH=$PATH:$HOME/.toolbox/bin
alias icat="kitty +kitten icat"

if type "zellij" > /dev/null; then
   alias tmux="zellij --layout $HOME/.config/zellij/layout.kdl"
fi

export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
if command -v pyenv >/dev/null
then
	export PATH="$PYENV_ROOT/bin:$PATH"
	eval "$(pyenv init -)"
fi

# Inject Nix environment by default
if [ -e $HOME/.nix-profile/etc/profile.d/nix.sh ]
then
	. $HOME/.nix-profile/etc/profile.d/nix.sh
fi

source ~/.zsh_plugins.sh

if [ -e /home/pi/.nix-profile/etc/profile.d/nix.sh ]; then . /home/pi/.nix-profile/etc/profile.d/nix.sh; fi # added by Nix installer

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

function _wcd {
   compadd $(dev ws ls " " || "")
}

function wcd {
   # if [[ $1 == "${uri_prefix_workspace}*" ]]; then
   #    builtin cd $(dev ws path $1)
   # else
   #    builtin cd $1
   # fi
   cd $(dev ws path $1)
}

compdef _wcd wcd
