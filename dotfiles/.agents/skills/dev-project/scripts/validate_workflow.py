#!/usr/bin/env python3
"""Mechanical handoff checks; never judge correctness or rewrite authorities."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import subprocess

STATUS = re.compile(r'^Status:\s*(\S+)\s*$', re.MULTILINE)
COMMIT = re.compile(r'^Commit:\s*`?([0-9a-fA-F]{7,64})`?\s*$', re.MULTILINE)


def marker(path: Path, pattern: re.Pattern[str], label: str) -> str:
    if not path.is_file():
        raise ValueError(f'Missing {label}: {path}')
    matches = pattern.findall(path.read_text(encoding='utf-8'))
    if not matches:
        raise ValueError(f'{label} has no parseable marker: {path}')
    if len(matches) != 1:
        raise ValueError(f'{label} has multiple markers: {path}')
    return matches[0]


def git(repo: Path, *args: str) -> str:
    return subprocess.run(['git', '-C', str(repo), *args], text=True, encoding='utf-8',
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout.strip()


def commit(repo: Path, rev: str) -> str:
    return git(repo, 'rev-parse', '--verify', '--end-of-options', f'{rev}^{{commit}}')


def check_task_rows(progress: Path) -> None:
    in_tasks, seen = False, set()
    for line in progress.read_text(encoding='utf-8').splitlines():
        if re.match(r'^#{1,2}\s+', line):
            in_tasks = line.strip().rstrip('#').strip().lower() == '## tasks'
        if in_tasks:
            row = re.match(r'^\s*[-*]\s+(?:Task\s+)?([0-9]+[A-Za-z]?):', line, re.IGNORECASE)
            if row:
                task = row[1].lower()
                if task in seen:
                    raise ValueError(f'Duplicate task row: {task} in {progress}; reconcile without discarding evidence')
                seen.add(task)


def check_project(project: Path) -> dict:
    if marker(project/'spec.md', STATUS, 'spec') != 'APPROVED':
        raise ValueError('spec.md is not APPROVED')
    if marker(project/'plan.md', STATUS, 'plan') != 'READY':
        raise ValueError('plan.md is not READY')
    if not (project/'progress.md').is_file():
        raise ValueError('Missing progress ledger')
    check_task_rows(project/'progress.md')
    if not (project/'work').is_dir():
        raise ValueError('Missing work directory')
    return {'status': 'PASS', 'kind': 'project', 'project': str(project)}


def check_index(repo: Path) -> dict:
    paths = git(repo, 'diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB', '-z', '--', ':(top)plans')
    if paths:
        raise ValueError('Workflow artifacts staged for commit: ' + paths.replace('\0', ', '))
    return {'status': 'PASS', 'kind': 'index'}


def check_build_report(repo: Path, candidate: str, report: Path) -> dict:
    candidate = commit(repo, candidate)
    if marker(report, STATUS, 'build report') != 'COMPLETED':
        raise ValueError('Build report is not COMPLETED')
    reported = marker(report, COMMIT, 'build report commit').lower()
    if candidate != commit(repo, reported):
        raise ValueError(f'Build report commit {reported} does not match candidate {candidate}')
    if not re.search(r'^Verification:\s*\S', report.read_text(encoding='utf-8'), re.MULTILINE):
        raise ValueError('Build report is missing nonempty Verification section')
    return {'status': 'PASS', 'kind': 'build-handoff', 'candidate': candidate}


def check_checkout(repo: Path, candidate: str) -> None:
    if commit(repo, 'HEAD') != candidate:
        raise ValueError('Checkout HEAD does not match candidate; do not use stale evidence')
    if git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', 'HEAD', '--'):
        raise ValueError('Tracked checkout changes are not in the candidate')


def check_candidate(repo: Path, base: str, candidate: str, report: Path) -> dict:
    base = commit(repo, base)
    candidate = check_build_report(repo, candidate, report)['candidate']
    check_checkout(repo, candidate)
    git(repo, 'merge-base', '--is-ancestor', base, candidate)
    paths = git(repo, 'log', '--format=', '--name-only', '--diff-filter=ACMRTUXB', f'{base}..{candidate}', '--', ':(top)plans')
    if paths:
        raise ValueError('Candidate range commits workflow artifacts: ' + paths)
    return {'status': 'PASS', 'kind': 'candidate', 'base': base, 'candidate': candidate}


def check_reviews(paths: list[Path], *, repo: Path | None = None, base: str | None = None,
                  candidate: str | None = None, contract: Path | None = None, mode: str | None = None,
                  previous: Path | None = None, repair_output: Path | None = None) -> dict:
    if len(paths) != 1 or not all((repo, base, candidate, contract, mode)):
        raise ValueError('One review report, repository, base, candidate, contract and mode are required; legacy verdict-only reports cannot approve work')
    from review_report import validate, write_new
    base, candidate = commit(repo, base), commit(repo, candidate)
    git(repo, 'merge-base', '--is-ancestor', base, candidate)
    check_checkout(repo, candidate)
    envelope, packet = validate(paths[0], base=base, candidate=candidate, contract=contract, mode=mode, previous=previous)
    if repair_output is not None and packet is not None and envelope['verdict'] == 'FIXES_REQUIRED':
        write_new(repair_output, packet)
        envelope['repair_packet'] = str(repair_output)
    return envelope


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('project-ready'); a.add_argument('--project', type=Path, required=True)
    a = sub.add_parser('index-safe'); a.add_argument('--repo', type=Path, required=True)
    a = sub.add_parser('candidate-ready')
    a.add_argument('--repo', type=Path, required=True); a.add_argument('--base', required=True)
    a.add_argument('--candidate', required=True); a.add_argument('--report', type=Path, required=True)
    a = sub.add_parser('build-handoff'); a.add_argument('--repo', type=Path, required=True); a.add_argument('--report', type=Path, required=True)
    a = sub.add_parser('reviews')
    a.add_argument('--repo', type=Path, required=True); a.add_argument('--base', required=True)
    a.add_argument('--candidate', required=True); a.add_argument('--report', type=Path, required=True)
    a.add_argument('--contract', type=Path, required=True)
    a.add_argument('--mode', choices=['task', 'repair', 'final', 'final-repair'], required=True)
    a.add_argument('--previous', type=Path); a.add_argument('--repair-output', type=Path)
    args = p.parse_args()
    try:
        if args.cmd == 'project-ready': result = check_project(args.project)
        elif args.cmd == 'index-safe': result = check_index(args.repo)
        elif args.cmd == 'candidate-ready': result = check_candidate(args.repo, args.base, args.candidate, args.report)
        elif args.cmd == 'build-handoff': result = check_build_report(args.repo, 'HEAD', args.report)
        else:
            result = check_reviews([args.report], repo=args.repo, base=args.base, candidate=args.candidate,
                                   contract=args.contract, mode=args.mode, previous=args.previous,
                                   repair_output=args.repair_output)
    except (OSError, UnicodeError, ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f'FAIL: {exc}')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
