# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi


# Enable history search
HISTFILE=~/.zsh_history
HISTSIZE=10000  # Save most-recent 1000 lines
SAVEHIST=10000  # Save most-recent 1000 lines


bindkey '^R' history-incremental-search-backward
bindkey -e # Enable ctrl-a and ctrl-e
bindkey "^[[1;5C" forward-word # Enable ctrl-right
bindkey "^[[1;5D" backward-word # Enable ctrl-left
bindkey  "^[[H"   beginning-of-line
bindkey  "^[[F"   end-of-line
bindkey  "^[[3~"  delete-char

# enable color support of ls and also add handy aliases
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    #alias dir='dir --color=auto'
    #alias vdir='vdir --color=auto'

    alias grep='grep --color=auto'
    alias fgrep='fgrep --color=auto'
    alias egrep='egrep --color=auto'
fi


# colored GCC warnings and errors
export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01'

# Uncomment the following line to enable command auto-correction.
ENABLE_CORRECTION="true"

zstyle ':completion:*' menu select

# some more ls aliases
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

# Add an "alert" alias for long running commands.  Use like so:
#   sleep 10; alert
alias alert='notify-send --urgency=low -i "$([ $? = 0 ] && echo terminal || echo error)" "$(history|tail -n1|sed -e '\''s/^\s*[0-9]\+\s*//;s/[;&|]\s*alert$//'\'')"'

# Alias definitions.
# You may want to put all your additions into a separate file like
# ~/.bash_aliases, instead of adding them here directly.
# See /usr/share/doc/bash-doc/examples in the bash-doc package.

# if the command-not-found package is installed, use it
function command_not_found_handler {
  # check because c-n-f could've been removed in the meantime
  if [ -x /usr/lib/command-not-found ]; then
     /usr/lib/command-not-found -- "$1"
     return $?
  elif [ -x /usr/share/command-not-found/command-not-found ]; then
     /usr/share/command-not-found/command-not-found -- "$1"
     return $?
  else
     printf "%s: command not found\n" "$1" >&2
     return 127
  fi
}



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
#export EDITOR="emacs"
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

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# function _wcd {
#    compadd $(dev ws ls " " || "")
# }
# 
# function wcd {
#    # if [[ $1 == "${uri_prefix_workspace}*" ]]; then
#    #    builtin cd $(dev ws path $1)
#    # else
#    #    builtin cd $1
#    # fi
#    cd $(dev ws path $1)
# }
# 
# compdef _wcd wcd

alias wcd="cd \$(dev ws path \$(dev ws ls ',' | sed 's/,/\n/g' | fzf))"
alias wf="echo \$(dev ws path \$(dev ws ls ',' | sed 's/,/\n/g' | fzf))"

# Nix no user uid: https://github.com/NixOS/nixpkgs/issues/64665
# export LD_PRELOAD=/lib/x86_64-linux-gnu/libnss_sss.so.2

if [ -e $HOME/.nix-profile/etc/profile.d/nix.sh ]; then . $HOME/.nix-profile/etc/profile.d/nix.sh; fi # added by Nix installer

# Use less viewer with a pre-processor to display improved previews for 
# a wide range of files (requires you to install at least exa, bat, chafa, exiftool
export FZF_PREVIEW_ADVANCED=true
export LESSOPEN='| lessfilter-fzf %s'

export AWS_EC2_METADATA_DISABLED=true

# Debug env setup
alias dap-go="dlv --headless=true --listen=:10001 --api-version=2 --log --log-output=dap exec"
export GOFLAGS="-gcflags=all=-N -gcflags=-l" # always include debug information
