#!/usr/bin/env bash
set -euo pipefail

completion_dir="${XDG_DATA_HOME:-$HOME/.local/share}/dev/completions"
mkdir -p "$completion_dir"

for shell in bash zsh; do
  temp_file=$(mktemp "$completion_dir/.dev.XXXXXX")
  if ! dev completions "$shell" >"$temp_file"; then
    rm -f "$temp_file"
    exit 1
  fi
  mv -f "$temp_file" "$completion_dir/dev.$shell"
done

case "${SHELL##*/}" in
  bash)
    rc_file="$HOME/.bashrc"
    hook="source '$completion_dir/dev.bash'"
    ;;
  zsh)
    rc_file="$HOME/.zshrc"
    hook="autoload -Uz compinit; compinit; source '$completion_dir/dev.zsh'"
    ;;
  *)
    printf 'Completion scripts installed in %s; add the appropriate shell hook manually for %s.\n' "$completion_dir" "${SHELL:-unknown shell}" >&2
    exit 0
    ;;
esac

touch "$rc_file"
if ! grep -Fxq "$hook" "$rc_file"; then
  printf '%s\n' "$hook" >>"$rc_file"
fi
printf 'Installed dev %s completion (restart your shell to activate).\n' "${SHELL##*/}"
