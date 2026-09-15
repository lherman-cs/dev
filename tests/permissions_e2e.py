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
import tomllib

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
        userhome = root/'user home'; userhome.mkdir()
        runtime = root/'runtime'; runtime.mkdir()
        for p in (home, shimdir, repo): p.mkdir()
        (home/'config.toml').write_text('')
        cache, cargo, data, state = [root/name for name in ('cache with.dots', 'cargo home', 'data', 'state')]
        for p in (cache, cargo, data, state): p.mkdir()
        (cargo/'credentials.toml').write_text('protected')
        capture = root/'argv.json'
        shim = shimdir/'codex'
        shim.write_text(f'#!{sys.executable}\nimport sys,json\nfrom pathlib import Path\nPath({str(capture)!r}).write_text(json.dumps(sys.argv[1:]))\n')
        shim.chmod(0o755)
        env = dict(os.environ, CODEX_HOME=str(home), HOME=str(userhome), XDG_RUNTIME_DIR=str(runtime), PATH=str(shimdir)+os.pathsep+os.environ['PATH'], XDG_CACHE_HOME=str(cache), CARGO_HOME=str(cargo), XDG_DATA_HOME=str(data), XDG_STATE_HOME=str(state))
        subprocess.run(['git','init','-q',str(repo)],check=True)
        subprocess.run(['git','-C',str(repo),'-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','--allow-empty','-qm','test: initial'],check=True)
        wt = root/'linked worktree'
        subprocess.run(['git','-C',str(repo),'worktree','add','-qb','probe',str(wt)],check=True)
        witness = root/'outside'; witness.write_text('protected')
        for cwd in (repo, wt):
            for name in ('.codex','.agents'):
                (cwd/name).mkdir(); (cwd/name/'sentinel').write_text('protected')
            for role, agent in [('spec','specifier'), ('plan','planner'), ('build','builder'), ('build','builder_strong'), ('project','orchestrator'), ('review','reviewer'), ('review','reviewer_strong'), ('explore','explorer')]:
                subprocess.run([str(binary),'a',role],cwd=cwd,env=env,check=True,capture_output=True)
                overrides = json.loads(capture.read_text())
                # No task was supplied: the launcher emits configuration only.
                assert all(overrides[i]=='-c' for i in range(0,len(overrides),2))
                source = tomllib.loads((ROOT/f'dotfiles/.codex/agents/{agent}.toml').read_text())
                overrides += ['-c', 'default_permissions='+json.dumps(source['default_permissions'])]
                can_commit = role in ('build','project')
                probe = f'''
import pathlib,subprocess,socket,tempfile,sqlite3
can_commit={can_commit!r}
readonly={role == 'explore'!r}
def denied(path):
    try:
        with pathlib.Path(path).open('a') as f: f.write('unexpected')
    except OSError: return
    raise AssertionError('unexpected write access: '+str(path))
for p in ['.codex/sentinel','.agents/sentinel',{str(witness)!r},{str(cargo/'credentials.toml')!r}]: denied(p)
with tempfile.TemporaryDirectory() as scratch:
    pathlib.Path(scratch,'research').write_text('scratch')
with socket.socket() as listener:
    listener.bind(('127.0.0.1',0))
    listener.listen()
    with socket.create_connection(listener.getsockname()) as client:
        peer,_=listener.accept()
        peer.close()
for directory in [{str(cache)!r}, {str(cargo)!r}, {str(data/'pnpm')!r}, {str(state/'pnpm')!r}]:
    if readonly:
        denied(pathlib.Path(directory)/'probe')
    else:
        pathlib.Path(directory).mkdir(parents=True,exist_ok=True)
        pathlib.Path(directory,'probe').write_text('cache')
if not readonly:
    with sqlite3.connect({str(data/'pnpm/index.db')!r}) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE IF NOT EXISTS probe (value TEXT)')
        db.execute('INSERT INTO probe VALUES (?)',({agent!r},))
if readonly:
    denied('candidate')
else:
    pathlib.Path('candidate').write_text({agent!r})
r=subprocess.run(['git','add','candidate'],capture_output=True,text=True)
assert (r.returncode == 0) == can_commit, r.stderr
if can_commit:
    subprocess.run(['git','-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','test: verify Git permissions'],check=True)
'''
                result = subprocess.run([codex,'sandbox',*overrides,'--',sys.executable,'-c',probe],cwd=cwd,env=dict(env,PATH=os.environ['PATH']),capture_output=True,text=True)
                assert result.returncode == 0, (cwd.name,agent,result.stdout,result.stderr)
                print(f'PASS {cwd.name}: {agent}')
        pnpm = shutil.which('pnpm')
        if pnpm:
            # Reproduce the reported pnpm SQLite failure with an empty package,
            # then prove the same install succeeds with the launcher profile.
            package = repo/'pnpm-probe'; package.mkdir()
            (package/'package.json').write_text('{"name":"permission-probe","version":"1.0.0","private":true}')
            (package/'pnpm-lock.yaml').write_text("lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n")
            subprocess.run([str(binary),'a','build'],cwd=repo,env=env,check=True,capture_output=True)
            overrides = json.loads(capture.read_text())
            pnpm_env = dict(env,PATH=os.environ['PATH'])
            store = subprocess.check_output([pnpm,'store','path'],cwd=package,env=pnpm_env,text=True).strip()
            Path(store).mkdir(parents=True,exist_ok=True)
            for profile, succeeds in [(':workspace',False), ('dev-builder',True)]:
                result = subprocess.run([codex,'sandbox',*overrides,'-c','default_permissions='+json.dumps(profile),'--',pnpm,'install','--frozen-lockfile','--ignore-scripts','--offline'],cwd=package,env=dict(env,PATH=os.environ['PATH']),capture_output=True,text=True)
                assert (result.returncode == 0) == succeeds, (profile,result.stdout,result.stderr)
                if not succeeds:
                    assert any(error in result.stdout+result.stderr for error in ('ERR_SQLITE_ERROR','EACCES','EROFS')), result.stdout+result.stderr
            print('PASS: real pnpm frozen install fails in baseline sandbox and succeeds with development grants')
        assert (home/'config.toml').read_text() == ''
    print('PASS: real sandbox; ordinary and linked repositories; no model calls')

if __name__ == '__main__': main()
