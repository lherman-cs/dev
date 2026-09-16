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


def check_project(project: Path, repo: Path | None = None) -> dict:
    if marker(project/'spec.md', STATUS, 'spec') != 'APPROVED':
        raise ValueError('spec.md is not APPROVED')
    if marker(project/'plan.md', STATUS, 'plan') != 'READY':
        raise ValueError('plan.md is not READY')
    if not (project/'progress.md').is_file():
        raise ValueError('Missing progress ledger')
    check_task_rows(project/'progress.md')
    check_recovery_rows(project, repo)
    if not (project/'work').is_dir():
        raise ValueError('Missing work directory')
    return {'status': 'PASS', 'kind': 'project', 'project': str(project)}



def check_recovery_rows(project: Path, repo: Path | None = None) -> None:
    """Check declared state against existing receipts; never edit or guess recovery."""
    from review_report import read_json, digest, validate as validate_review
    from package_review import render
    text = (project/'progress.md').read_text(encoding='utf-8')
    in_tasks = False
    def artifact(value: str) -> Path:
        path = Path(value)
        return path if path.is_absolute() else (repo or project)/path
    for line in text.splitlines():
        if re.match(r'^#{1,2}\s+', line):
            in_tasks = line.strip() == '## Tasks'
        if not in_tasks:
            continue
        row = re.match(r'^\s*[-*]\s+(?:Task\s+)?([0-9]+[A-Za-z]?):\s+(\S+)(.*)$', line, re.IGNORECASE)
        if not row:
            continue
        task, state, details = row.groups()
        if state not in {'PENDING', 'BUILD', 'BUILDING', 'REVIEW', 'REPAIR', 'ACCEPTED', 'BLOCKED', 'REPLAN', 'REPLAN_REQUIRED'}:
            raise ValueError(f'Unknown task state for {task}: {state}')
        fields = dict(re.findall(r'(\w+)=([^;\]]+)', details))
        fields = {k: v.strip() for k, v in fields.items()}
        count = fields.get('repairs', '0/2')
        if not re.fullmatch(r'[0-2]/2', count):
            raise ValueError(f'Invalid repair count for {task}: {count}')
        if repo is None:
            continue  # Structural API only; CLI orchestration supplies --repo.
        if 'repairs' not in fields:
            raise ValueError(f'Task {task} needs durable repairs=0/2 metadata; reconcile existing evidence')
        if state != 'ACCEPTED':
            # A carried packet is the durable counter floor during a repair/restart.
            previous = fields.get('previous', 'none')
            if previous != 'none':
                packet = read_json(artifact(previous))
                floor = packet.get('repair_round')
                if type(floor) is not int or int(count[0]) < floor:
                    raise ValueError(f'Repair count reset for {task}')
            continue
        required = ('candidate', 'contract', 'review', 'package')
        if any(fields.get(k, 'none') == 'none' for k in required):
            raise ValueError(f'ACCEPTED task {task} lacks candidate-bound evidence')
        report_path, contract, package = (artifact(fields[k]) for k in ('review', 'contract', 'package'))
        report = read_json(report_path)
        if report.get('candidate') != commit(repo, fields['candidate']):
            raise ValueError(f'Accepted candidate mismatch for {task}')
        previous = artifact(fields['previous']) if fields.get('previous', 'none') != 'none' else None
        expected, _ = render(repo, report['base'], report['candidate'], contract, previous)
        if package.read_bytes() != expected.encode():
            raise ValueError(f'Accepted package mismatch for {task}')
        envelope, _ = validate_review(report_path, base=report['base'], candidate=report['candidate'],
                                     contract=contract, mode=report['mode'], previous=previous, package=package)
        if envelope['verdict'] != 'PASS' or int(count[0]) != envelope['repair_round']:
            raise ValueError(f'Accepted review/count mismatch for {task}')
    waves = re.findall(r'^Final fix waves: *(\S+)', text, re.MULTILINE)
    if waves and (len(waves) != 1 or waves[0] not in {'0/1', '1/1'}):
        raise ValueError('Invalid final fix wave count')


def untracked_snapshot(repo: Path, exclude: list[Path] = ()) -> dict:
    """Nonignored inputs only. Ignored build caches/environment are not reproducibility proof."""
    from review_report import digest
    root = Path(git(repo, 'rev-parse', '--show-toplevel')).resolve()
    excluded = {str(p.absolute()) for p in exclude}
    raw = subprocess.check_output(['git', '-C', str(repo), 'ls-files', '--others', '--exclude-standard', '-z'], text=True, encoding='utf-8')
    result = {}
    for name in filter(None, raw.split('\0')):
        path = root/name
        if str(path.absolute()) in excluded:
            continue
        if path.is_symlink():
            result[name] = 'symlink:' + str(path.readlink())
        elif path.is_file():
            result[name] = digest(path)
        else:
            raise ValueError(f'Cannot fingerprint untracked input: {name}')
    return result


def check_untracked(repo: Path, baseline: Path, exclude: list[Path] = ()) -> None:
    from review_report import read_json
    before = read_json(baseline)
    root = str(Path(git(repo, 'rev-parse', '--show-toplevel')).resolve())
    if before.get('repo') != root or not isinstance(before.get('files'), dict):
        raise ValueError('Untracked baseline belongs to a different repository')
    current = untracked_snapshot(repo, [baseline, *exclude])
    bad = [p for p, value in current.items() if before['files'].get(p) != value]
    if bad:
        raise ValueError('New or changed untracked inputs are absent from the candidate: ' + ', '.join(bad))


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
    if re.findall(r'^Verification-Status: *(PASS|FAIL|BLOCKED) *$', report.read_text(encoding='utf-8'), re.MULTILINE) != ['PASS']:
        raise ValueError('Required verification must declare PASS in Verification-Status')
    return {'status': 'PASS', 'kind': 'build-handoff', 'candidate': candidate}


def check_checkout(repo: Path, candidate: str) -> None:
    if commit(repo, 'HEAD') != candidate:
        raise ValueError('Checkout HEAD does not match candidate; do not use stale evidence')
    if git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', 'HEAD', '--'):
        raise ValueError('Tracked checkout changes are not in the candidate')


def check_candidate(repo: Path, base: str, candidate: str, report: Path, baseline: Path | None = None) -> dict:
    base = commit(repo, base)
    candidate = check_build_report(repo, candidate, report)['candidate']
    check_checkout(repo, candidate)
    if baseline is not None:
        check_untracked(repo, baseline, [report])
    git(repo, 'merge-base', '--is-ancestor', base, candidate)
    paths = git(repo, 'log', '--format=', '--name-only', '--diff-filter=ACMRTUXB', f'{base}..{candidate}', '--', ':(top)plans')
    if paths:
        raise ValueError('Candidate range commits workflow artifacts: ' + paths)
    return {'status': 'PASS', 'kind': 'candidate', 'base': base, 'candidate': candidate}


def check_reviews(paths: list[Path], *, repo: Path | None = None, base: str | None = None,
                  candidate: str | None = None, contract: Path | None = None, mode: str | None = None,
                  previous: Path | None = None, repair_output: Path | None = None,
                  package: Path | None = None, validation: Path | None = None) -> dict:
    if len(paths) != 1 or not all((repo, base, candidate, contract, mode)):
        raise ValueError('One review report, repository, base, candidate, contract and mode are required; legacy verdict-only reports cannot approve work')
    if package is None:
        raise ValueError('The exact review --package is required')
    from review_report import validate, write_new, contract_metadata
    from package_review import render
    binding = contract_metadata(contract)
    family = 'final' if mode.startswith('final') else 'task'
    if mode != 'clarification' and binding['kind'] != family:
        raise ValueError('Review mode does not match task/final contract')
    base, candidate = commit(repo, base), commit(repo, candidate)
    git(repo, 'merge-base', '--is-ancestor', base, candidate)
    check_checkout(repo, candidate)
    expected, _ = render(repo, base, candidate, contract, previous, validation)
    if package.read_bytes() != expected.encode('utf-8'):
        raise ValueError('Review package is stale, altered, or not the exact Git range/evidence')
    envelope, packet = validate(paths[0], base=base, candidate=candidate, contract=contract, mode=mode, previous=previous, package=package)
    if repair_output is not None and packet is not None:
        write_new(repair_output, packet)
        envelope['repair_packet'] = str(repair_output)
    return envelope


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('project-ready'); a.add_argument('--project', type=Path, required=True); a.add_argument('--repo', type=Path, required=True)
    a = sub.add_parser('untracked-baseline'); a.add_argument('--repo', type=Path, required=True); a.add_argument('--output', type=Path, required=True)
    a = sub.add_parser('index-safe'); a.add_argument('--repo', type=Path, required=True)
    a = sub.add_parser('candidate-ready')
    a.add_argument('--repo', type=Path, required=True); a.add_argument('--base', required=True)
    a.add_argument('--candidate', required=True); a.add_argument('--report', type=Path, required=True)
    a.add_argument('--untracked-baseline', type=Path)
    a = sub.add_parser('build-handoff'); a.add_argument('--repo', type=Path, required=True); a.add_argument('--report', type=Path, required=True)
    a = sub.add_parser('reviews')
    a.add_argument('--repo', type=Path, required=True); a.add_argument('--base', required=True)
    a.add_argument('--candidate', required=True); a.add_argument('--report', type=Path, required=True)
    a.add_argument('--contract', type=Path, required=True)
    a.add_argument('--mode', choices=['task', 'repair', 'final', 'final-repair', 'clarification'], required=True)
    a.add_argument('--package', type=Path, required=True)
    a.add_argument('--validation', type=Path)
    a.add_argument('--previous', type=Path); a.add_argument('--repair-output', type=Path)
    args = p.parse_args()
    try:
        if args.cmd == 'project-ready': result = check_project(args.project, args.repo)
        elif args.cmd == 'untracked-baseline':
            from review_report import write_new
            root = str(Path(git(args.repo, 'rev-parse', '--show-toplevel')).resolve())
            write_new(args.output, {'repo': root, 'files': untracked_snapshot(args.repo, [args.output])})
            result = {'status': 'PASS', 'baseline': str(args.output)}
        elif args.cmd == 'index-safe': result = check_index(args.repo)
        elif args.cmd == 'candidate-ready': result = check_candidate(args.repo, args.base, args.candidate, args.report, args.untracked_baseline)
        elif args.cmd == 'build-handoff': result = check_build_report(args.repo, 'HEAD', args.report)
        else:
            result = check_reviews([args.report], repo=args.repo, base=args.base, candidate=args.candidate,
                                   contract=args.contract, mode=args.mode, previous=args.previous,
                                   repair_output=args.repair_output, package=args.package, validation=args.validation)
    except (OSError, UnicodeError, ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f'FAIL: {exc}')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
