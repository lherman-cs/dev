#!/usr/bin/env python3
"""Extract one immutable task brief from plan.md and append bounded execution metadata."""
from __future__ import annotations
import argparse
from pathlib import Path
import re

TASK = re.compile(r'^### Task\s+([0-9]+[A-Za-z]?):\s+.+$', re.MULTILINE)

def extract(plan: str, task_id: str) -> str:
    matches = list(TASK.finditer(plan))
    for i, match in enumerate(matches):
        if match.group(1).lower() == task_id.lower():
            end = matches[i + 1].start() if i + 1 < len(matches) else len(plan)
            return plan[match.start():end].rstrip() + '\n'
    raise ValueError(f'Task {task_id!r} not found; expected heading like "### Task {task_id}: ..."')

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', type=Path, required=True)
    p.add_argument('--task', required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--base', required=True)
    p.add_argument('--report', required=True)
    p.add_argument('--ruling', action='append', default=[])
    p.add_argument('--fact', action='append', default=[])
    args = p.parse_args()
    if args.output.exists():
        raise SystemExit(f'Refusing to rewrite immutable brief: {args.output}')
    task = extract(args.plan.read_text(), args.task)
    lines = ['# Task Brief', '', '## Planned Task', '', task.rstrip(), '', '## Execution Context',
             f'- Base commit: `{args.base}`', f'- Build report: `{args.report}`']
    if args.ruling:
        lines += ['', 'Relevant controller rulings:', *[f'- {x}' for x in args.ruling]]
    if args.fact:
        lines += ['', 'Established facts:', *[f'- {x}' for x in args.fact]]
    lines += ['', 'The Planned Task above is copied verbatim from plan.md. This brief is immutable after dispatch.', '']
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text('\n'.join(lines))

if __name__ == '__main__':
    main()
