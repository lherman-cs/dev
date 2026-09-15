#!/usr/bin/env python3
"""Mechanical workflow checks only; never judge semantics or silently repair artifacts."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import subprocess

STATUS = re.compile(r'^Status:\s*(\S+)\s*$', re.MULTILINE)
VERDICT = re.compile(r'^Verdict:\s*(PASS|FIXES_REQUIRED|BLOCKED)\s*$', re.MULTILINE)
COMMIT = re.compile(r'^Commit:\s*`?([0-9a-fA-F]{7,64})`?\s*$', re.MULTILINE)

def marker(path: Path, pattern: re.Pattern[str], label: str) -> str:
    if not path.is_file():
        raise ValueError(f'Missing {label}: {path}')
    match = pattern.search(path.read_text())
    if not match:
        raise ValueError(f'{label} has no parseable marker: {path}')
    return match.group(1)

def git(repo: Path, *args: str) -> str:
    return subprocess.run(['git', '-C', str(repo), *args], text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True).stdout.strip()

def check_project(project: Path) -> dict:
    spec, plan = project/'spec.md', project/'plan.md'
    if marker(spec, STATUS, 'spec') != 'APPROVED':
        raise ValueError('spec.md is not APPROVED')
    if marker(plan, STATUS, 'plan') != 'READY':
        raise ValueError('plan.md is not READY')
    progress = project/'progress.md'
    if not progress.is_file():
        raise ValueError(f'Missing progress ledger: {progress}')
    if not (project/'work').is_dir():
        raise ValueError(f'Missing work directory: {project / "work"}')
    return {'status':'PASS','kind':'project','project':str(project)}

def check_candidate(repo: Path, base: str, candidate: str, report: Path) -> dict:
    base = git(repo, 'rev-parse', '--verify', f'{base}^{{commit}}')
    candidate = git(repo, 'rev-parse', '--verify', f'{candidate}^{{commit}}')
    subprocess.run(['git','-C',str(repo),'merge-base','--is-ancestor',base,candidate],check=True)
    if marker(report, STATUS, 'build report') != 'COMPLETED':
        raise ValueError('Build report is not COMPLETED')
    reported = marker(report, COMMIT, 'build report commit').lower()
    if not candidate.lower().startswith(reported) and not reported.startswith(candidate.lower()):
        raise ValueError(f'Build report commit {reported} does not match candidate {candidate}')
    if 'Verification:' not in report.read_text():
        raise ValueError('Build report is missing Verification section')
    return {'status':'PASS','kind':'candidate','base':base,'candidate':candidate}

def check_reviews(paths: list[Path]) -> dict:
    verdicts = {str(p): marker(p, VERDICT, 'review report') for p in paths}
    return {'status':'PASS','kind':'reviews','verdicts':verdicts}

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('project-ready'); a.add_argument('--project',type=Path,required=True)
    a = sub.add_parser('candidate-ready'); a.add_argument('--repo',type=Path,required=True); a.add_argument('--base',required=True); a.add_argument('--candidate',required=True); a.add_argument('--report',type=Path,required=True)
    a = sub.add_parser('reviews'); a.add_argument('--report',type=Path,action='append',required=True)
    args = p.parse_args()
    try:
        if args.cmd == 'project-ready': result = check_project(args.project)
        elif args.cmd == 'candidate-ready': result = check_candidate(args.repo,args.base,args.candidate,args.report)
        else: result = check_reviews(args.report)
    except (ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f'FAIL: {exc}')
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
