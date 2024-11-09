zstyle ':completion:*:*:make:*' tag-order 'targets'
autoload -U compinit && compinit
. "$HOME/.cargo/env"
