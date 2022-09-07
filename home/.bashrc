alias vim='nvim'
alias vi='vim'
alias v='vim'

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
export TERM=xterm

source $HOME/.work.bashrc
