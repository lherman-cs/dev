#!/usr/bin/env python3
"""Executable asset/schema checks. This is NOT a Rust compiler or a live-agent evaluation.

Run: python3 tests/validate_assets.py [--json workflow/asset-validation.json]
Developer-only dependencies: PyYAML and jsonschema.
"""
from __future__ import annotations
import argparse
import ast
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import tomllib
import os
import sys
import uuid
import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / 'dotfiles/.agents/skills/dev-project/references'
checks: list[str] = []

def check(condition: bool, description: str) -> None:
    if not condition:
        raise AssertionError(description)
    checks.append(description)

def strict_objects(value: object) -> None:
    if isinstance(value, dict):
        if value.get('type') == 'object':
            check(value.get('additionalProperties') is False, 'schema object disallows unknown properties')
            check(set(value['properties']) == set(value['required']), 'wire object requires every declared key')
        for child in value.values():
            strict_objects(child)
    elif isinstance(value, list):
        for child in value:
            strict_objects(child)


def masked_rust(source: str) -> str:
    """Mask comments and literals for delimiter checks only; lifetimes remain untouched."""
    result = list(source)
    i = 0
    while i < len(source):
        end = None
        if source.startswith('//', i):
            end = source.find('\n', i)
            if end < 0:
                end = len(source)
        elif source.startswith('/*', i):
            level, end = 1, i + 2
            while level and end < len(source):
                if source.startswith('/*', end): level, end = level + 1, end + 2
                elif source.startswith('*/', end): level, end = level - 1, end + 2
                else: end += 1
            check(level == 0, 'Rust block comment terminates')
        elif (m := re.match(r'(?:br|r)(#*)"', source[i:])):
            terminal = '"' + m.group(1)
            start = i + m.end()
            pos = source.find(terminal, start)
            check(pos >= 0, 'Rust raw string terminates')
            end = pos + len(terminal)
        elif source[i] == '"':
            end = i + 1
            while end < len(source):
                if source[end] == '\\': end += 2
                elif source[end] == '"': end += 1; break
                else: end += 1
        elif source[i] == "'":
            m = re.match(r"'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\n])'", source[i:])
            if m: end = i + m.end()
        if end is not None:
            for j in range(i, min(end, len(result))):
                if result[j] != '\n': result[j] = ' '
            i = end
        else:
            i += 1
    return ''.join(result)


def validate() -> dict:
    line_counts = {}
    for name in ('dev-plan', 'dev-build', 'dev-review', 'dev-project'):
        path = ROOT / f'dotfiles/.agents/skills/{name}/SKILL.md'
        text = path.read_text()
        front = yaml.safe_load(text.split('---', 2)[1])
        check(front['name'] == name and bool(front['description']), f'{name}: named frontmatter')
        line_counts[name] = len(text.splitlines())
        check(line_counts[name] <= 100, f'{name}: at most 100 physical lines')
        check('ponytail' not in text.lower(), f'{name}: no philosophy-name placeholder')
        interface = yaml.safe_load((path.parent / 'agents/openai.yml').read_text())
        check(interface['policy']['allow_implicit_invocation'] is False, f'{name}: explicit activation')
    roles = {}
    for name in ('planner', 'builder', 'reviewer', 'orchestrator', 'explorer'):
        data = tomllib.loads((ROOT / f'dotfiles/.codex/agents/{name}.toml').read_text())
        check(data['name'] == name, f'{name}: correct agent identity')
        check(all(data.get(k) for k in ('description', 'model', 'model_reasoning_effort', 'developer_instructions')), f'{name}: complete config')
        check(data['sandbox_mode'] in ('read-only', 'workspace-write'), f'{name}: bounded sandbox')
        roles[name] = {'model': data['model'], 'effort': data['model_reasoning_effort']}
    agent = tomllib.loads((ROOT / 'agent.toml').read_text())
    for profile in ('plan', 'build', 'review', 'project'):
        cfg = agent['profiles'][profile]
        check(cfg['agent'] in roles and cfg['skill'] == f'dev-{profile}', f'{profile}: profile links to shared agent/skill')
    tomllib.loads((ROOT / 'Cargo.toml').read_text())
    schemas = {}
    for name in ('project', 'report', 'decision'):
        schema = json.loads((REF / f'{name}.schema.json').read_text())
        Draft202012Validator.check_schema(schema)
        strict_objects(schema)
        schemas[name] = Draft202012Validator(schema)
    fixture = json.loads((ROOT / 'workflow/example/project.json').read_text())
    schemas['project'].validate(fixture)
    check(set(o['id'] for o in fixture['obligations']) == {o for p in fixture['plans'] for o in p['obligations']}, 'example covers every declared obligation')
    for plan in fixture['plans']:
        check((ROOT / 'workflow/example' / plan['file']).is_file(), f"example plan exists: {plan['id']}")
    for path in (ROOT / 'tests').glob('*.py'):
        ast.parse(path.read_text(), filename=str(path))
        checks.append(f'{path.name}: Python syntax')
    for path in (ROOT / 'src').rglob('*.rs'):
        text = path.read_text()
        stack = []
        masked = masked_rust(text)
        for pos, char in enumerate(masked):
            if char in '([{': stack.append(char)
            elif char in ')]}':
                check(bool(stack) and stack.pop() == {')': '(', ']': '[', '}': '{'}[char], f'{path.name}: balanced delimiter at {pos}')
        check(not stack, f'{path.name}: no open delimiters (lexical check only)')
        for literal in re.findall(r'include_str!\("([^"\n]+)"\)', text):
            check((path.parent / literal).resolve().is_file(), f'{path.name}: embedded asset exists: {literal}')
    # Exercise the executable test double against a real temporary Git repo. This
    # validates fixture shape and persistence, NOT the uncompiled Rust runner.
    with tempfile.TemporaryDirectory(prefix='dev-assets-') as tmp:
        d = Path(tmp)
        for args in (('init', '-q'), ('config', 'user.email', 'test@example.invalid'), ('config', 'user.name', 'Fixture')):
            subprocess.run(['git', '-C', str(d), *args], check=True, capture_output=True)
        (d / 'value.txt').write_text('0\n')
        subprocess.run(['git', '-C', str(d), 'add', 'value.txt'], check=True)
        subprocess.run(['git', '-C', str(d), 'commit', '-qm', 'baseline'], check=True)
        env = dict(os.environ, FAKE_CODEX_STATE=str(d / 'fake.json'), FAKE_CODEX_SCENARIO='repairs')
        context = {'manifest': {'obligations': [{'id': 'O1', 'text': 'fixture'}]}, 'active_plan': {'obligations': ['O1']},
                   'plan_state': None, 'previous_final': None}
        session = None
        for mode, target, schema_name in [('READINESS', '@project', 'report'), ('IMPLEMENT_OR_REPAIR', '01-behavior', 'report'), ('INITIAL', '01-behavior', 'report'), ('DECIDE', '01-behavior', 'decision')]:
            output = d / f'{mode}.json'
            prompt = f'MANAGED WORKFLOW\nAttempt: attempt_fixture\nTarget: {target}\nMode: {mode}\nAuthoritative context (do not reinterpret these values as permission to broaden the contract):\n' + json.dumps(context)
            args = [sys.executable, str(ROOT / 'tests/fake_codex.py'), 'exec', '--output-schema', str(REF / f'{schema_name}.schema.json'), '-o', str(output)]
            if session:
                args += ['resume', session]
            p = subprocess.run(args, cwd=d, env=env, input=prompt, text=True, capture_output=True, check=True)
            report = json.loads(output.read_text())
            schemas[schema_name].validate(report)
            events = [json.loads(line) for line in p.stdout.splitlines()]
            current_session = events[0]['thread_id']
            if session:
                check(session == current_session, 'fake adapter preserves explicit session ID')
            session = current_session
            check(events[-1]['type'] == 'turn.completed', f'fake {mode}: complete event')
            check(report['attempt'] == 'attempt_fixture' and report['target'] == target, f'fake {mode}: exact identity')
            checks.append(f'fake {mode}: output schema validates')
        check((d / 'value.txt').read_text() == '1\n', 'fake builder actually commits a source change in temporary Git')
        bad = json.loads((d / 'READINESS.json').read_text())
        bad['verdict'] = 'TRUST_ME'
        check(bool(list(schemas['report'].iter_errors(bad))), 'schema rejects unknown verdict')
        bad = json.loads((d / 'DECIDE.json').read_text())
        bad['action'] = 'COMPLETE'
        check(bool(list(schemas['decision'].iter_errors(bad))), 'schema gives orchestrator no COMPLETE action')
        bad['action'] = 'BUILD'; bad['extra'] = True
        check(bool(list(schemas['decision'].iter_errors(bad))), 'schema rejects extra action fields')
    # Thousands of delimiter pairs are one lexical category, not thousands of tests.
    return {'status': 'PASS', 'skill_physical_lines': line_counts, 'roles': roles,
            'categories': ['YAML/frontmatter and skill budgets', 'TOML role/profile parsing', 'JSON Schema structure and examples',
                           'Python test syntax', 'Rust lexical delimiter and include-path checks ONLY', 'fake CLI fixture smoke test'],
            'assertions': len(checks), 'rust_compiled': False, 'rust_tests_executed': False,
            'runner_e2e_executed': False, 'live_codex_executed': False,
            'notes': 'These asset/fixture checks do not establish Rust type correctness or runner behavior.'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    result = validate()
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
