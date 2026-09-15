#!/usr/bin/env python3
"""Create an exact Git review package for one immutable base..candidate range."""
from __future__ import annotations
import argparse
from pathlib import Path
import subprocess

def git(repo: Path, *args: str) -> str:
    return subprocess.run(['git', '-C', str(repo), *args], text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True).stdout

def commit(repo: Path, rev: str) -> str:
    return git(repo, 'rev-parse', '--verify', f'{rev}^{{commit}}').strip()

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo', type=Path, required=True)
    p.add_argument('--base', required=True)
    p.add_argument('--candidate', required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    if args.output.exists():
        raise SystemExit(f'Refusing to rewrite immutable review package: {args.output}')
    base, candidate = commit(args.repo, args.base), commit(args.repo, args.candidate)
    subprocess.run(['git', '-C', str(args.repo), 'merge-base', '--is-ancestor', base, candidate], check=True)
    stat = git(args.repo, 'diff', '--stat', '--find-renames', base, candidate)
    log = git(args.repo, 'log', '--oneline', '--no-decorate', f'{base}..{candidate}')
    diff = git(args.repo, 'diff', '--no-ext-diff', '--find-renames', '--find-copies', base, candidate, '--')
    text = (f'# Review Package\n\nBase: `{base}`\nCandidate: `{candidate}`\n\n'
            f'## Commits\n```text\n{log.rstrip()}\n```\n\n'
            f'## Diff stat\n```text\n{stat.rstrip()}\n```\n\n'
            f'## Exact diff\n```diff\n{diff.rstrip()}\n```\n')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text)

if __name__ == '__main__':
    main()
