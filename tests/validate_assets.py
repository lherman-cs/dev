#!/usr/bin/env python3
"""Local structural validation for the Rust workflow middleware and agent assets."""
from __future__ import annotations
import argparse, ast, json, re, tomllib
from pathlib import Path
import yaml

ROOT=Path(__file__).resolve().parents[1]
ROLE_SKILLS={
    'specifier':'dev-spec','planner':'dev-plan','builder':'dev-build','builder_strong':'dev-build',
    'reviewer':'dev-review','reviewer_strong':'dev-review','orchestrator':'dev-project','explorer':None,
}
PUBLIC_SKILLS={x for x in ROLE_SKILLS.values() if x}

def validate(root:Path=ROOT)->dict:
    checks=[]
    def check(cond,label):
        if not cond: raise AssertionError(label)
        checks.append(label)

    config=tomllib.loads((root/'agent.toml').read_text())
    roles=root/'dotfiles/.codex/agents'; skills=root/'dotfiles/.agents/skills'
    check(set(config['profiles'])=={'default','spec','plan','build','review','project','explore'},'canonical public commands')
    check({p.stem for p in roles.glob('*.toml')}==set(ROLE_SKILLS),'exact role set')
    check({p.name for p in skills.iterdir() if p.is_dir()}==PUBLIC_SKILLS,'exact public skill set')
    registry=(root/'src/agent_roles.rs').read_text()
    router=(root/'src/dev.rs').read_text(); workflow=(root/'src/workflow.rs').read_text()
    workflow += ''.join(p.read_text() for p in sorted((root/'src/workflow_parts').glob('*.rs')))
    cargo=(root/'Cargo.toml').read_text()
    check('mod workflow;' in router,'Rust workflow module registered')
    check('workflow::run(cli.action)' in router,'dev workflow dispatched to Rust middleware')
    check('autobins = false' in cargo and 'path = "src/dev.rs"' in cargo and 'path = "src/main.rs"' in cargo,'dev router and legacy core bins declared')
    check('pub const EXTRA_ASSETS: &[ExtraAsset] = &[];' in registry,'no legacy prompt/script runtime assets')
    check(not (skills/'dev-project/scripts').exists(),'legacy Python workflow scripts removed')
    check(not (skills/'dev-project/prompts').exists(),'legacy workflow prompt packet layer removed')
    for required in ['workflow.sqlite3','PRAGMA user_version=1','BEGIN IMMEDIATE','MAX_VERIFICATION_FAILURES','MAX_REPLANS','final_rereview','expected_head']:
        check(required in workflow,f'workflow invariant present: {required}')
    for role,skill in ROLE_SKILLS.items():
        data=tomllib.loads((roles/f'{role}.toml').read_text())
        check(data['name']==role,f'{role}: identity')
        check(data['model_reasoning_effort'] in {'low','medium','high','xhigh','max'},f'{role}: effort')
        check(data['default_permissions'] in config['codex']['permissions'],f'{role}: permissions')
        if skill:
            check(f'${skill}' in data['developer_instructions'],f'{role}: skill authority')
            token=f'role_with_skill!("{role}", "{skill}")'
        else:
            token=f'role_only!("{role}")'
        check(token in registry,f'{role}: embedded registration')
        check('fork_turns="none"' in data['developer_instructions'] or role=='explorer',f'{role}: fresh child policy')
    for skill in sorted(PUBLIC_SKILLS):
        path=skills/skill/'SKILL.md'; text=path.read_text(); header=yaml.safe_load(text.split('---',2)[1])
        check(header['name']==skill and header['description'],f'{skill}: metadata')
        check('gpt-' not in text.lower(),f'{skill}: model-free skill')
        check(len(text.encode())<10000,f'{skill}: bounded instructions')
        ui=yaml.safe_load((path.parent/'agents/openai.yaml').read_text())
        check(ui['policy']['allow_implicit_invocation'] is False,f'{skill}: explicit activation')
    for path in [*(root/'tests').glob('*.py'),*(root/'scripts').glob('*.py')]:
        ast.parse(path.read_text()); check(True,f'Python syntax: {path.relative_to(root)}')
    check('sqlite' in (root/'install.sh').read_text(),'bootstrap installs sqlite')
    check(re.search(r'\n\s*sqlite\n',(root/'flake.nix').read_text()) is not None,'Nix package set includes sqlite')
    just=(root/'Justfile').read_text()
    check('workflow_e2e.py' in just,'compiled workflow E2E wired')
    check('cargo test --locked' in just,'Rust tests remain locked')
    workflow_doc=(root/'WORKFLOW.md').read_text()
    requirements=(root/'skill-requirements.md').read_text()
    for phrase in ['Three authorities only.','No context landfill.','One writer per worktree.','not event sourcing','generic workflow engine']:
        check(phrase in workflow_doc,f'workflow design guardrail documented: {phrase}')
    for phrase in ['Git owns code/candidate reality','SQLite is private implementation detail','One writer/controller per worktree','generic workflow engine']:
        check(phrase in requirements,f'workflow requirement guardrail documented: {phrase}')
    check('//! - SQLite stores only workflow bookkeeping.' in workflow,'Rust module documents SQLite scope')
    return {'status':'PASS','assertions':len(checks),'rust_compiled':False,'live_codex_executed':False}

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--json',type=Path); args=ap.parse_args(); result=validate()
    if args.json: args.json.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
