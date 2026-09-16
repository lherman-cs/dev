#!/usr/bin/env python3
"""Freeze exact Git evidence without importing the diff into controller context."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def git(repo: Path, *args: str) -> str:
    return subprocess.run(['git', '-C', str(repo), '--no-pager', '-c', 'color.ui=false', *args],
                          text=True, encoding='utf-8', stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True).stdout


def commit(repo: Path, rev: str) -> str:
    return git(repo, 'rev-parse', '--verify', '--end-of-options', f'{rev}^{{commit}}').strip()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo', type=Path, required=True)
    p.add_argument('--base', required=True)
    p.add_argument('--candidate', required=True)
    p.add_argument('--brief', type=Path, help='Immutable task/final contract; required for gated review')
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    try:
        base, candidate = commit(args.repo, args.base), commit(args.repo, args.candidate)
        git(args.repo, 'merge-base', '--is-ancestor', base, candidate)
        contract = hashlib.sha256(args.brief.read_bytes()).hexdigest() if args.brief else None
        meta = {'base': base, 'candidate': candidate, 'contract_sha256': contract}
        stat = git(args.repo, 'diff', '--no-ext-diff', '--no-textconv', '--stat', base, candidate, '--')
        log = git(args.repo, 'log', '--no-show-signature', '--format=%h %s', f'{base}..{candidate}')
        diff = git(args.repo, 'diff', '--no-ext-diff', '--no-textconv', '--binary', '--full-index',
                   '--find-renames', '-U10', base, candidate, '--')
        text = ('# Review Package\n\n```json\n' + json.dumps(meta, indent=2) + '\n```\n\n'
                f'## Commits\n```text\n{log.rstrip()}\n```\n\n'
                f'## Diff stat\n```text\n{stat.rstrip()}\n```\n\n'
                f'## Exact diff\n````diff\n{diff.rstrip()}\n````\n')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as handle:
            handle.write(text)
        print(json.dumps({'package': str(args.output), **meta}))
    except (OSError, UnicodeError, ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f'FAIL: {exc}')


if __name__ == '__main__':
    main()
