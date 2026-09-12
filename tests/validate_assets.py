#!/usr/bin/env python3
"""Validate workflow assets and source wiring, NOT Rust compilation or live agent behavior.
Run: python3 tests/validate_assets.py [--json VALIDATION.json]
Developer dependency: PyYAML (python3 -m pip install -r tests/requirements.txt).
"""
from __future__ import annotations
import argparse
import ast
import json
from pathlib import Path
import re
import tomllib
import yaml

ROOT = Path(__file__).resolve().parents[1]
ROLES = {'specifier':'dev-spec', 'planner':'dev-plan', 'builder':'dev-build',
         'reviewer':'dev-review', 'orchestrator':'dev-project', 'explorer':'dev-explore'}
checks: list[str] = []

def check(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)
    checks.append(label)

def reject_model_policy(table: dict) -> None:
    for key, value in table.items():
        check(key not in {'model','model_reasoning_effort','default_subagent_model',
                          'default_subagent_reasoning_effort'}, f'No duplicate overlay selection: {key}')
        if isinstance(value, dict):
            reject_model_policy(value)

def rust_delimiters(source: str) -> None:
    """Lexically skip Rust comments/literals and match delimiters; NOT a Rust parser."""
    i = 0; stack = []
    pairs = {')':'(',']':'[','}':'{'}
    while i < len(source):
        if source.startswith('//', i):
            pos = source.find('\n', i); i = len(source) if pos < 0 else pos; continue
        if source.startswith('/*', i):
            depth = 1; i += 2
            while i < len(source) and depth:
                if source.startswith('/*',i): depth += 1; i += 2
                elif source.startswith('*/',i): depth -= 1; i += 2
                else: i += 1
            assert depth == 0, 'Unclosed Rust comment'; continue
        raw = re.match(r'(?:br|cr|r)(#*)"',source[i:])
        if raw:
            end = '"'+raw.group(1); pos = source.find(end,i+raw.end())
            assert pos >= 0, 'Unclosed Rust raw string'; i = pos+len(end); continue
        if source[i] == '"':
            i += 1
            while i < len(source):
                if source[i] == '\\': i += 2
                elif source[i] == '"': i += 1; break
                else: i += 1
            else: raise AssertionError('Unclosed Rust string')
            continue
        char = re.match(r"'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\n])'",source[i:])
        if char: i += char.end(); continue
        ch = source[i]
        if ch in '([{': stack.append(ch)
        elif ch in ')]}':
            assert stack and stack.pop() == pairs[ch], f'Unbalanced Rust delimiter at {i}'
        i += 1
    assert not stack, 'Unclosed Rust delimiters'

def validate(root: Path = ROOT) -> dict:
    checks.clear()
    config = tomllib.loads((root/'agent.toml').read_text())
    reject_model_policy(config['codex'])
    check(set(config['profiles']) == {'default','spec','plan','build','review','project','explore'}, 'All profiles exist')
    for profile, values in config['profiles'].items():
        check(set(values) == {'role'} and values['role'] in ROLES, f'{profile}: role reference only')
    check(config['codex']['agents']['max_concurrent_threads_per_session'] == 3, 'Three-child concurrency policy retained')
    check(config['codex']['approvals_reviewer'] == 'auto_review', 'Existing command-approval policy preserved')
    role_lines = {}; skill_lines = {}; selections = {}; spawn_examples = 0
    for role, skill in ROLES.items():
        role_path = root/f'dotfiles/.codex/agents/{role}.toml'
        role_source = role_path.read_text(); data = tomllib.loads(role_source)
        check(data['name'] == role, f'{role}: named standalone agent')
        check(all(isinstance(data.get(k), str) and data[k].strip() for k in
                  ('description','model','model_reasoning_effort','sandbox_mode','developer_instructions')), f'{role}: required configuration')
        role_lines[role] = len(role_source.splitlines())
        check(role_lines[role] < 100, f'{role}: under 100 physical lines')
        check(data['model_reasoning_effort'] in ('high','medium'), f'{role}: valid selected effort')
        check(f'${skill}' in data['developer_instructions'], f'{role}: explicit skill binding')
        selections[role] = [data['model'],data['model_reasoning_effort']]
        path = root/f'dotfiles/.agents/skills/{skill}/SKILL.md'
        source = path.read_text(); skill_lines[skill] = len(source.splitlines())
        check(skill_lines[skill] < 100, f'{skill}: under 100 physical lines')
        check(source.startswith('---\n'), f'{skill}: YAML frontmatter')
        front = yaml.safe_load(source.split('---',2)[1])
        check(front['name'] == skill and bool(front['description']), f'{skill}: valid skill metadata')
        ui = yaml.safe_load((path.parent/'agents/openai.yaml').read_text())
        check(ui['policy']['allow_implicit_invocation'] is False, f'{skill}: explicit activation')
        check(not (path.parent/'agents/openai.yml').exists(), f'{skill}: no stale alternate UI config')
        for text in [source, data['developer_instructions']]:
            check('human' in text.lower() and 'stage' in text.lower(), f'{role}: human control is explicit')
            check('fork_turns' in text and 'none' in text, f'{role}: fresh-context policy is explicit')
            check('close_agent(' not in text and 'resume_agent(' not in text, f'{role}: no legacy lifecycle calls')
            check('close completed children' not in text and 'close finished children' not in text, f'{role}: no obsolete lifecycle instructions')
            for match in re.finditer(r'(interrupt_agent|followup_task)\((\{[^\n]*?\})\)', text):
                args = json.loads(match[2])
                required = {'target'} if match[1] == 'interrupt_agent' else {'target','message'}
                check(set(args) == required and all(args.values()), f'{role}: valid {match[1]} example')
            for match in re.finditer(r'spawn_agent\((\{[^\n]*?\})\)',text):
                args = json.loads(match[1]); spawn_examples += 1
                check(set(args) == {'task_name','agent_type','fork_turns','message'}, f'{role}: complete v2 spawn example without model override')
                check(args['fork_turns'] == 'none', f'{role}: explicit no inherited turns')
                check(bool(re.fullmatch('[a-z0-9_]+',args['task_name'])), f'{role}: valid task name')
                allowed = {'specifier','planner','builder','reviewer'} if role=='orchestrator' else {'explorer'}
                check(role!='explorer' and args['agent_type'] in allowed, f'{role}: correct child boundary')
        if role=='explorer':
            check(data['sandbox_mode']=='read-only' and data['agents']['enabled'] is False, 'Explorer read-only leaf defaults')
        if role=='reviewer':
            check(data['sandbox_mode']=='read-only', 'Reviewer read-only default')
    check(spawn_examples >= 10, 'Actual explicit spawn examples supplied across callers')
    # Source wiring checks, not execution.
    main = (root/'src/main.rs').read_text()
    check('mod agent_roles;' in main, 'Role loader actually wired into Rust main')
    check('role: String' in main and '#[serde(deny_unknown_fields)]' in main, 'Profile type rejects duplicate selection fields')
    check('agent_roles::load(&selected.role)?' in main, 'Root selection derives from canonical role')
    check('command.args(agent_roles::registration_args(&dir)?);' in main, 'Spawn role registrations passed to Codex')
    check('command.arg("--").arg(prompt)' in main, 'Task is a positional prompt, not CLI flags')
    check('agent_prompt(&config, profile, &prompt, &dir)?' in main, 'Role activates even without initial task')
    check('fn reject_duplicate_model_policy' in main, 'Nested duplicate model policy rejected')
    check('fn exec_codex_resume(session: Option<String>, last: bool)' in main, 'Resume contract retained and extended')
    for path in (root/'src').rglob('*.rs'):
        source = path.read_text(); rust_delimiters(source)
        check(True, f'{path.relative_to(root)}: lexical delimiter check ONLY')
        for match in re.finditer(r'include_str!\("([^\"]+)"\)',source):
            check((path.parent/match[1]).is_file(), f'Existing include path: {match[1]}')
    registry = (root/'src/agent_roles.rs').read_text()
    for role, skill in ROLES.items():
        check(f'asset!("{role}", "{skill}")' in registry, f'{role}: embedded canonical assets')
    for path in [*(root/'tests').glob('*.py'), *(root/'scripts').glob('*.py')]:
        ast.parse(path.read_text()); check(True, f'{path.name}: Python syntax')
    return {'status':'PASS','assertions':len(checks),'role_physical_lines':role_lines,
            'skill_physical_lines':skill_lines,'model_selections':selections,
            'validated_spawn_examples':spawn_examples,
            'rust_compiled':False,'rust_unit_tests_executed':False,
            'compiled_launcher_e2e_executed':False,'live_codex_executed':False,
            'notes':'TOML/YAML and explicit-spawn contract checks plus source wiring and lexical checks only. Not a Rust compiler or agent behavior evaluation.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json',type=Path)
    args=parser.parse_args(); result=validate()
    if args.json:
        args.json.parent.mkdir(parents=True,exist_ok=True)
        args.json.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
