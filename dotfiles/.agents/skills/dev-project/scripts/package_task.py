#!/usr/bin/env python3
"""Extract one immutable task brief from plan.md and append bounded execution metadata."""
from __future__ import annotations
import argparse
from pathlib import Path
import re

TASK = re.compile(r'^### Task\s+([0-9]+[A-Za-z]?):\s+.+$', re.MULTILINE)

def headings(plan: str) -> list[tuple[int, str]]:
    """Locate section boundaries without treating fenced examples as headings."""
    result = []
    offset = 0
    fence = None
    for line in plan.splitlines(keepends=True):
        delimiter = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line.rstrip('\r\n'))
        if fence is not None:
            if (delimiter and delimiter[1][0] == fence[0]
                    and len(delimiter[1]) >= len(fence) and not delimiter[2].strip()):
                fence = None
        elif delimiter:
            fence = delimiter[1]
        elif re.match(r'^#{1,2}\s+', line) or TASK.fullmatch(line.rstrip('\r\n')):
            result.append((offset, line.rstrip('\r\n')))
        offset += len(line)
    return result

def extract(plan: str, task_id: str) -> str:
    sections = headings(plan)
    tasks = [(i, TASK.fullmatch(line)) for i, (_, line) in enumerate(sections)]
    tasks = [(i, match) for i, match in tasks if match]
    ids = [match.group(1).lower() for _, match in tasks]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate task IDs; cannot extract an unambiguous brief')
    for i, match in tasks:
        if match.group(1).lower() == task_id.lower():
            start = sections[i][0]
            end = sections[i + 1][0] if i + 1 < len(sections) else len(plan)
            return plan[start:end].rstrip() + '\n'
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
    p.add_argument('--scope', action='append', default=[],
                   help='Operational split instruction: unit ID, assigned/deferred requirements, dependencies, and checks; repeat as needed. Original task text is preserved.')
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
    if args.scope:
        if any(not scope.strip() for scope in args.scope):
            p.error('--scope must not be empty')
        lines += ['', '## Operational unit scope',
                  'Apply this unit scope to the original Planned Task above. Deferred sibling requirements are not missing behavior in this unit review.',
                  *[f'- {x}' for x in args.scope],
                  'The controller records unit coverage and acceptance in progress.md; the parent task remains pending until all units and integration obligations pass.']
    lines += ['', 'The Planned Task above is copied verbatim from plan.md. This brief is immutable after dispatch.', '']
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text('\n'.join(lines))

if __name__ == '__main__':
    main()
