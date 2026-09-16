#!/usr/bin/env python3
"""Extract one immutable task contract, or print a compact plan index."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re

TASK = re.compile(r'^### Task\s+([0-9]+[A-Za-z]?):\s+.+$', re.MULTILINE)


def headings(plan: str) -> list[tuple[int, str]]:
    """Ignore fenced examples when finding section boundaries."""
    result, offset, fence = [], 0, None
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


def task_sections(plan: str) -> tuple[list[tuple[int, str]], list[tuple[int, re.Match]]]:
    sections = headings(plan)
    tasks = [(i, TASK.fullmatch(line)) for i, (_, line) in enumerate(sections)]
    tasks = [(i, match) for i, match in tasks if match]
    ids = [match.group(1).lower() for _, match in tasks]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate task IDs; cannot extract an unambiguous brief')
    return sections, tasks


def extract(plan: str, task_id: str) -> str:
    sections, tasks = task_sections(plan)
    for i, match in tasks:
        if match.group(1).lower() == task_id.lower():
            end = sections[i + 1][0] if i + 1 < len(sections) else len(plan)
            return plan[sections[i][0]:end].rstrip() + '\n'
    raise ValueError(f'Task {task_id!r} not found; expected heading like "### Task {task_id}: ..."')


def constraints(plan: str) -> str:
    sections = headings(plan)
    matches = [i for i, (_, line) in enumerate(sections) if line == '## Global Constraints']
    if len(matches) > 1:
        raise ValueError('Duplicate Global Constraints sections')
    if not matches:
        return ''
    i = matches[0]
    end = sections[i + 1][0] if i + 1 < len(sections) else len(plan)
    return plan[sections[i][0]:end].rstrip()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', type=Path, required=True)
    selection = p.add_mutually_exclusive_group(required=True)
    selection.add_argument('--list', action='store_true', help='Print headings and binding global constraints only')
    selection.add_argument('--task')
    selection.add_argument('--final', action='store_true', help='Freeze approved spec, current plan and compact ledger for final review')
    p.add_argument('--spec', type=Path)
    p.add_argument('--progress', type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--base')
    p.add_argument('--report')
    p.add_argument('--ruling', action='append', default=[])
    p.add_argument('--fact', action='append', default=[])
    p.add_argument('--scope', action='append', default=[], help='Explicit coverage/deferred requirements for an operational unit')
    args = p.parse_args()
    try:
        plan = args.plan.read_text(encoding='utf-8')
        if args.list:
            sections, tasks = task_sections(plan)
            print(json.dumps({'plan': str(args.plan), 'tasks': [sections[i][1] for i, _ in tasks],
                              'constraints': constraints(plan)}, ensure_ascii=False))
            return
        if not all((args.output, args.base, args.report)):
            p.error('--output, --base and --report are required unless --list is used')
        if any(not value.strip() for value in [*args.scope, *args.ruling, *args.fact]):
            p.error('Execution metadata must not be empty')
        if not re.fullmatch(r'[0-9a-f]{7,64}', args.base):
            p.error('--base must be a commit ID, not a mutable branch name')
        if args.final:
            if not args.spec or not args.progress or args.scope:
                p.error('--final requires --spec and --progress and does not accept --scope')
            spec = args.spec.read_text(encoding='utf-8')
            for text, expected in [(spec, 'APPROVED'), (plan, 'READY')]:
                if re.findall(r'^Status:\s*(\S+)\s*$', text, re.MULTILINE) != [expected]:
                    raise ValueError(f'Final snapshot requires exactly one {expected} marker')
            from review_report import declared_verification
            declared_verification(Path(args.report))
            lines = ['# Final review contract', '', '## Approved specification', '', spec.rstrip(),
                     '', '## Current execution plan', '', plan.rstrip(),
                     '', '## Ledger snapshot', '', args.progress.read_text(encoding='utf-8').rstrip(),
                     '', '## Execution Context', f'- Project base: `{args.base}`',
                     f'- Initial validation report: `{args.report}`',
                     '- Use the current candidate-specific validation report supplied by the dispatch.']
        else:
            task = extract(plan, args.task)
            lines = ['# Task Brief', '', constraints(plan), '', '## Planned Task', '', task.rstrip(),
                     '', '## Execution Context', f'- Base commit: `{args.base}`', f'- Initial build report: `{args.report}`',
                     '- Use the current candidate-specific build report supplied by the dispatch.']
        for title, values in [('Relevant approved rulings', args.ruling), ('Established facts', args.fact),
                              ('Operational unit scope', args.scope)]:
            if values:
                lines += ['', f'## {title}', *[f'- {x}' for x in values]]
        if args.scope:
            lines += ['Deferred sibling requirements are not omissions in this unit. The parent task is accepted only after all units and integration checks pass.']
        lines += ['', 'Authority excerpts are copied verbatim. This contract is immutable after dispatch.', '']
        meta = {'schema': 1, 'kind': 'final' if args.final else 'task', 'base': args.base}
        text = '<!-- dev-contract: ' + json.dumps(meta, sort_keys=True) + ' -->\n' + '\n'.join(lines)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as handle:
            handle.write(text)
        print(json.dumps({'brief': str(args.output), 'contract_sha256': hashlib.sha256(text.encode('utf-8')).hexdigest()}))
    except (OSError, UnicodeError, ValueError) as exc:
        raise SystemExit(f'FAIL: {exc}')


if __name__ == '__main__':
    main()
