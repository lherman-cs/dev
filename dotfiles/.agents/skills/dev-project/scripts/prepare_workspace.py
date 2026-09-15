#!/usr/bin/env python3
"""Establish local workflow ignores without changing tracked files or the index."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess

def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()

def prepare(repo: Path) -> dict:
    repo = Path(git(repo, 'rev-parse', '--show-toplevel'))
    # Resolve through Git: .git can be a file in a linked worktree.
    exclude = Path(git(repo, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'))
    ignored = subprocess.run(['git', '-C', str(repo), 'check-ignore', '--no-index', '-q',
                              '--', 'plans/.dev-workflow-probe']).returncode
    if ignored not in (0, 1):
        raise ValueError('Cannot determine workflow ignore state')
    if ignored:
        exclude.parent.mkdir(parents=True, exist_ok=True)
        current = exclude.read_text() if exclude.exists() else ''
        if '/plans/' not in current.splitlines():
            with exclude.open('a') as handle:
                handle.write(('\n' if current and not current.endswith('\n') else '') + '/plans/\n')
        subprocess.run(['git', '-C', str(repo), 'check-ignore', '--no-index', '-q',
                        '--', 'plans/.dev-workflow-probe'], check=True)
    tracked = git(repo, 'ls-files', '-z', '--', ':(top)plans').split('\0')
    tracked = [p for p in tracked if p]
    if tracked:
        raise ValueError('Already tracked workflow artifacts (ignores cannot untrack them); '
                         'preserve working files and arrange bounded index cleanup: ' + ', '.join(tracked))
    return {'status': 'PASS', 'kind': 'workspace-artifacts', 'repo': str(repo)}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.repo)))
    except (ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f'FAIL: {exc}')
