#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agent="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
package="$repo/pi"

npm ci --ignore-scripts --prefix "$package"
mkdir -p "$agent"
# Seed user instructions only once; existing instructions are never overwritten.
[[ -e "$agent/AGENTS.md" || -L "$agent/AGENTS.md" ]] || cp "$package/AGENTS.md" "$agent/AGENTS.md"
# Retire only this repository's old runtime; never delete user settings/auth.
for item in extensions/dev-workflow.ts dev-workflow.json; do
  if [[ -e "$agent/$item" || -L "$agent/$item" ]]; then
    backup="$agent/dev-workflow-backup/$(date +%s)-$$/$item"
    mkdir -p "$(dirname "$backup")"
    mv "$agent/$item" "$backup"
  fi
done
if [[ -e "$agent/dev-workflow" && ! -L "$agent/dev-workflow" ]]; then
  echo "Refusing to replace non-symlink $agent/dev-workflow" >&2
  exit 1
fi
ln -sfn "$package" "$agent/dev-workflow"
# Pi updates its package list; unrelated packages and settings remain intact.
PI_CODING_AGENT_DIR="$agent" node --input-type=module - "$package" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const agent = process.env.PI_CODING_AGENT_DIR;
const executable = path.join(process.argv[2], 'node_modules/.bin/pi');
const settings = path.join(agent, 'settings.json');
const packages = fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, 'utf8')).packages || [] : [];
const owned = /^npm:(pi-subagents|@narumitw\/pi-(?:lsp|github-pr|chrome-devtools|usage)|pi-web-access|pi-mcp-adapter|@juicesharp\/rpiv-todo|@juicesharp\/rpiv-ask-user-question)(@[^/]+)?$/;
for (const entry of packages) {
  const source = typeof entry === 'string' ? entry : entry.source;
  if (owned.test(source)) execFileSync(executable, ['remove', source], { stdio: 'inherit' });
}
execFileSync(executable, ['install', path.join(agent, 'dev-workflow')], { stdio: 'inherit' });
JS
printf '%s\n' 'Pi workflow installed. Run dev a spec; log in with /login -> OpenAI Codex if needed.'
