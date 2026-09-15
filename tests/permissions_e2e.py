#!/usr/bin/env python3
"""Test compiled launcher permissions with real Codex, no model calls.
Run outside an enclosing Codex sandbox: python tests/permissions_e2e.py --binary target/debug/dev
Uses disposable repositories under this checkout and never changes user config.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    args = parser.parse_args()
    binary = args.binary.resolve()
    codex = shutil.which('codex')
    assert codex, 'Codex must be installed'
    with tempfile.TemporaryDirectory(prefix='dev-permissions-', dir=ROOT) as temp:
        root = Path(temp)
        home, shimdir, repo = root/'config', root/'bin', root/'repo with.dots'
        for p in (home, shimdir, repo): p.mkdir()
        (home/'config.toml').write_text('')
        capture = root/'argv.json'
        shim = shimdir/'codex'
        shim.write_text(f'#!{sys.executable}\nimport sys,json\nfrom pathlib import Path\nPath({str(capture)!r}).write_text(json.dumps(sys.argv[1:]))\n')
        shim.chmod(0o755)
        env = dict(os.environ, CODEX_HOME=str(home), PATH=str(shimdir)+os.pathsep+os.environ['PATH'])
        subprocess.run(['git','init','-q',str(repo)],check=True)
        subprocess.run(['git','-C',str(repo),'-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','--allow-empty','-qm','test: initial'],check=True)
        wt = root/'linked worktree'
        subprocess.run(['git','-C',str(repo),'worktree','add','-qb','probe',str(wt)],check=True)
        witness = root/'outside'; witness.write_text('protected')
        for cwd in (repo, wt):
            for name in ('.codex','.agents'):
                (cwd/name).mkdir(); (cwd/name/'sentinel').write_text('protected')
            for role in ('build','project','review','explore'):
                subprocess.run([str(binary),'a',role],cwd=cwd,env=env,check=True,capture_output=True)
                overrides = json.loads(capture.read_text())
                # No task was supplied: the launcher emits configuration only.
                assert all(overrides[i]=='-c' for i in range(0,len(overrides),2))
                can_commit = role in ('build','project')
                probe = f'''
import pathlib,subprocess
can_commit={can_commit!r}
readonly={role == 'explore'!r}
def denied(path):
    try:
        with pathlib.Path(path).open('a') as f: f.write('unexpected')
    except OSError: return
    raise AssertionError('unexpected write access: '+str(path))
for p in ['.codex/sentinel','.agents/sentinel',{str(witness)!r}]: denied(p)
if readonly:
    denied('candidate')
else:
    pathlib.Path('candidate').write_text({role!r})
r=subprocess.run(['git','add','candidate'],capture_output=True,text=True)
assert (r.returncode == 0) == can_commit, r.stderr
if can_commit:
    subprocess.run(['git','-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','test: verify Git permissions'],check=True)
'''
                result = subprocess.run([codex,'sandbox',*overrides,'--',sys.executable,'-c',probe],cwd=cwd,env=dict(os.environ,CODEX_HOME=str(home)),capture_output=True,text=True)
                assert result.returncode == 0, (cwd.name,role,result.stdout,result.stderr)
                print(f'PASS {cwd.name}: {role}')
        assert (home/'config.toml').read_text() == ''
    print('PASS: real sandbox; ordinary and linked repositories; no model calls')

if __name__ == '__main__': main()
