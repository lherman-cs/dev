#!/usr/bin/env python3
"""Local structural validation. Does not claim Rust compilation or LLM behavior."""
from __future__ import annotations
import argparse
import ast
import json
from pathlib import Path
import re
import tomllib
import yaml

ROOT = Path(__file__).resolve().parents[1]
ROLE_SKILLS = {
    'specifier': 'dev-spec', 'planner': 'dev-plan', 'builder': 'dev-build',
    'builder_strong': 'dev-build', 'reviewer': 'dev-review',
    'reviewer_strong': 'dev-review', 'orchestrator': 'dev-project', 'explorer': None,
}
PUBLIC_SKILLS = {s for s in ROLE_SKILLS.values() if s}
PROMPTS = {
    'explore-facts.md', 'plan-project.md', 'replan-project.md', 'build-task.md',
    'fix-task.md', 'task-review.md', 'scoped-rereview.md', 'final-review.md',
    'report-contract.md', 'progress-template.md',
}
HELPERS = {'package_task.py', 'package_review.py', 'review_report.py',
           'validate_workflow.py', 'prepare_workspace.py'}


def validate(root: Path = ROOT) -> dict:
    checks = []
    def check(condition: bool, label: str) -> None:
        if not condition:
            raise AssertionError(label)
        checks.append(label)

    config = tomllib.loads((root/'agent.toml').read_text())
    fragment = tomllib.loads((root/'dotfiles/.codex/config.fragment.toml').read_text())
    def no_models(table: dict) -> None:
        for key, value in table.items():
            check(key not in {'model', 'model_reasoning_effort', 'default_subagent_model',
                              'default_subagent_reasoning_effort'}, f'No duplicate overlay model policy: {key}')
            if isinstance(value, dict): no_models(value)
    no_models(config['codex'])
    check(config['codex']['agents'] == fragment['agents'], 'Standalone/launcher agent settings agree')
    check(config['codex']['agents']['max_concurrent_threads_per_session'] == 4, 'Bounded four-thread capacity')
    profiles = config['profiles']
    check(set(profiles) == {'default', 'spec', 'plan', 'build', 'review', 'project', 'explore'}, 'Canonical public commands')
    check(all(p['role'] in ROLE_SKILLS for p in profiles.values()), 'Every command resolves a role')
    roles = root/'dotfiles/.codex/agents'
    check({p.stem for p in roles.glob('*.toml')} == set(ROLE_SKILLS), 'Exactly the intended role aliases')
    skills = root/'dotfiles/.agents/skills'
    check({p.name for p in skills.iterdir() if p.is_dir()} == PUBLIC_SKILLS, 'Exactly five public skills')
    selections, sizes = {}, {}
    registry = (root/'src/agent_roles.rs').read_text()
    for role, skill in ROLE_SKILLS.items():
        data = tomllib.loads((roles/f'{role}.toml').read_text())
        check(data['name'] == role, f'{role}: identity')
        check(isinstance(data['model'], str) and bool(data['model'].strip()), f'{role}: explicit model')
        check(data['model_reasoning_effort'] in {'low','medium','high','xhigh','max'}, f'{role}: explicit effort')
        selections[role] = [data['model'], data['model_reasoning_effort']]
        instructions = data['developer_instructions']
        check('fork_turns="none"' in instructions, f'{role}: fresh handoff')
        check(data['default_permissions'] in config['codex']['permissions'], f'{role}: declared permissions')
        token = f'role_with_skill!("{role}", "{skill}")' if skill else f'role_only!("{role}")'
        check(token in registry, f'{role}: embedded registration')
        if skill: check(f'${skill}' in instructions, f'{role}: same skill for root and child')
        if role.startswith('reviewer'):
            check('repository source as read-only' in instructions, f'{role}: readonly source contract')
        if role == 'explorer':
            check(data['agents']['enabled'] is False, 'Explorer cannot spawn agents')
            check('$dev-' not in instructions, 'Explorer is not a public workflow skill')
    # Selection is reported, not copied into a second EXPECTED_MODELS authority.
    for skill in sorted(PUBLIC_SKILLS):
        path = skills/skill/'SKILL.md'; text = path.read_text()
        header = yaml.safe_load(text.split('---',2)[1])
        check(header['name'] == skill and bool(header['description']), f'{skill}: discovery metadata')
        check('gpt-' not in text.lower(), f'{skill}: model-free procedure')
        check(len(text.encode()) <= 12000, f'{skill}: bounded resident instruction bytes')
        sizes[skill] = len(text.encode())
        ui = yaml.safe_load((path.parent/'agents/openai.yaml').read_text())
        check(ui['policy']['allow_implicit_invocation'] is False, f'{skill}: explicit activation')
    support = skills/'dev-project'
    check({p.name for p in (support/'prompts').glob('*.md')} == PROMPTS, 'Single-review prompt set; no retired dimensions')
    check({p.name for p in (support/'scripts').glob('*.py')} == HELPERS, 'Small mechanical helper set')
    for kind, names in [('prompts',PROMPTS), ('scripts',HELPERS)]:
        for name in names:
            embedded = f'skills/dev-project/{kind}/{name}'
            check(f'path: "{embedded}"' in registry, f'Launcher materializes {embedded}')
            check(f'include_str!("../dotfiles/.agents/{embedded}")' in registry, f'Launcher embeds {embedded}')
    for match in re.finditer(r'include_str!\("([^"]+)"\)', registry):
        check((root/'src'/match[1]).is_file(), f'Existing Rust include: {match[1]}')
    for path in [*(support/'scripts').glob('*.py'), *(root/'tests').glob('*.py'), *(root/'scripts').glob('*.py')]:
        ast.parse(path.read_text()); check(True, f'Python syntax: {path.relative_to(root)}')
    for path in skills.rglob('*.md'):
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', path.read_text()):
            if not target.startswith(('http:', 'https:', '#')) and '<' not in target:
                check((path.parent/target.split('#')[0]).exists(), f'Existing support reference: {path.name} -> {target}')
    just = (root/'Justfile').read_text()
    for recipe in ['test-fast:', 'test-slow:', 'test: test-fast test-slow', 'check: test']:
        check(recipe in just, f'Local recipe {recipe}')
    check('tests/validate_assets.py' in just and "unittest discover" in just, 'Fast local coverage wired')
    check('cargo test --locked' in just and 'launcher_e2e.py' in just, 'Real Rust/launcher checks retained')
    cases = yaml.safe_load((root/'tests/workflow_pressure_cases.yaml').read_text())
    check(isinstance(cases,list) and len(cases)>=12, 'Broad pressure scenario catalog')
    check(len({c['id'] for c in cases}) == len(cases), 'Unique pressure scenarios')
    for case in cases:
        check(set(case) == {'id','role','pressure','must','must_not'}, f'Pressure schema: {case["id"]}')
        check(case['role'] in ROLE_SKILLS and all(isinstance(x,str) and x.strip() for x in case.values()), f'Pressure scope: {case["id"]}')
    return {'status':'PASS', 'assertions':len(checks), 'model_selections':selections,
            'skill_bytes':sizes, 'pressure_cases':len(cases),
            'rust_compiled':False, 'live_codex_executed':False}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json',type=Path)
    args=parser.parse_args(); result=validate()
    if args.json:
        args.json.parent.mkdir(parents=True,exist_ok=True)
        args.json.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
