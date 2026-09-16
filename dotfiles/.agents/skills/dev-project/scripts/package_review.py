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


def render(repo: Path, base: str, candidate: str, brief: Path | None = None,
           previous: Path | None = None, validation: Path | None = None) -> tuple[str, dict]:
    from review_report import contract_metadata, digest, _packet, declared_verification, require, read_json
    base, candidate = commit(repo, base), commit(repo, candidate)
    git(repo, 'merge-base', '--is-ancestor', base, candidate)
    contract = digest(brief) if brief else None
    if brief:
        binding = contract_metadata(brief)
        if previous:
            same_candidate = read_json(previous).get('candidate') == candidate
            packet = _packet(previous, base=candidate if same_candidate else base, contract=contract)
            if same_candidate:
                require(packet['base'] == base, 'Clarification must preserve the reviewed range')
            require(packet['family'] == binding['kind'], 'Packet and contract review family differ')
        else:
            require(base == commit(repo, binding['base']), 'Review BASE differs from immutable contract; partial task diffs cannot pass')
        if binding['kind'] == 'final':
            require(validation is not None, 'Final review requires candidate-bound validation')
    if validation:
        declared_verification(validation, candidate)
    meta = {'base': base, 'candidate': candidate, 'contract_sha256': contract,
            'previous_sha256': digest(previous) if previous else None,
            'validation_sha256': digest(validation) if validation else None}
    stat = git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--stat', base, candidate, '--')
    log = git(repo, 'log', '--no-show-signature', '--format=%h %s', f'{base}..{candidate}')
    diff = git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--binary', '--full-index',
               '--find-renames', '-U10', base, candidate, '--')
    text = ('# Review Package\n\n```json\n' + json.dumps(meta, indent=2) + '\n```\n\n'
            f'## Commits\n```text\n{log.rstrip()}\n```\n\n'
            f'## Diff stat\n```text\n{stat.rstrip()}\n```\n\n'
            f'## Exact diff\n````diff\n{diff.rstrip()}\n````\n')
    return text, meta


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo', type=Path, required=True)
    p.add_argument('--base', required=True)
    p.add_argument('--candidate', required=True)
    p.add_argument('--brief', type=Path, help='Immutable task/final contract; required for gated review')
    p.add_argument('--previous', type=Path, help='Previous findings packet for a repair')
    p.add_argument('--validation', type=Path, help='Candidate-specific validation report, mandatory for final review')
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    try:
        text, meta = render(args.repo, args.base, args.candidate, args.brief, args.previous, args.validation)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as handle:
            handle.write(text)
        print(json.dumps({'package': str(args.output), 'package_sha256': hashlib.sha256(text.encode()).hexdigest(), **meta}))
    except (OSError, UnicodeError, ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f'FAIL: {exc}')


if __name__ == '__main__':
    main()
