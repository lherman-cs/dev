#!/usr/bin/env python3
"""Exercise the compiled Rust `dev workflow` middleware against disposable Git repos."""
from pathlib import Path
import argparse, json, shutil, subprocess, tempfile


def run(repo: Path, binary: Path, *args: str, ok=True):
    p=subprocess.run([str(binary),'workflow',*args],cwd=repo,text=True,capture_output=True)
    if ok and p.returncode:
        raise AssertionError((args,p.stdout,p.stderr))
    if not ok:
        return p
    return json.loads(p.stdout)

def git(repo: Path,*args: str):
    subprocess.run(['git','-C',str(repo),*args],check=True,capture_output=True,text=True)

def commit(repo: Path,msg: str):
    git(repo,'add','-A'); git(repo,'-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm',msg)

def new_repo(root: Path):
    repo=root/'repo'; repo.mkdir(); git(repo,'init','-q')
    (repo/'.gitignore').write_text('plans/\n')
    (repo/'plans').mkdir()
    (repo/'plans/spec.md').write_text('# Probe\n\nStatus: APPROVED\n\nWrite value.txt.\n')
    commit(repo,'test: base')
    return repo

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--binary',type=Path,required=True)
    binary=ap.parse_args().binary.resolve(); assert binary.is_file()
    if not shutil.which('sqlite3'): raise SystemExit('sqlite3 is required for workflow_e2e.py')
    with tempfile.TemporaryDirectory(prefix='dev-workflow-e2e-') as tmp:
        repo=new_repo(Path(tmp))
        assert run(repo,binary,'init','--spec','plans/spec.md')['phase']=='planning'
        task=run(repo,binary,'plan','add','--title','write value','--goal','create the accepted value',
                 '--requirement','value.txt contains exactly ok\\n','--path','value.txt','--check','python3 -c "from pathlib import Path; assert Path(\'value.txt\').read_text() == \'ok\\\\n\'"')['task']
        run(repo,binary,'plan','ready')
        nxt=run(repo,binary,'next'); assert nxt['action']=='build' and nxt['task']==task
        (repo/'value.txt').write_text('ok\n'); commit(repo,'feat: write value')
        result=run(repo,binary,'candidate','submit','--task',str(task),'--sha','HEAD'); assert result['status']=='verified'
        assert run(repo,binary,'next')['action']=='review'
        run(repo,binary,'review','finish','--task',str(task),'--verdict','pass')
        assert run(repo,binary,'next')['action']=='final_review'
        run(repo,binary,'final','finish','--verdict','pass')
        assert run(repo,binary,'next')['action']=='complete'

    with tempfile.TemporaryDirectory(prefix='dev-workflow-repair-') as tmp:
        repo=new_repo(Path(tmp)); run(repo,binary,'init','--spec','plans/spec.md')
        task=run(repo,binary,'plan','add','--title','repair value','--goal','write correct value','--requirement','value.txt is ok','--path','value.txt')['task']
        run(repo,binary,'plan','ready'); run(repo,binary,'next')
        (repo/'value.txt').write_text('bad\n'); commit(repo,'feat: initial value')
        run(repo,binary,'candidate','submit','--task',str(task),'--sha','HEAD')
        finding=run(repo,binary,'review','finding','--task',str(task),'--severity','important','--summary','wrong value','--evidence','value.txt contains bad')['finding']
        run(repo,binary,'review','finish','--task',str(task),'--verdict','fixes-required')
        assert run(repo,binary,'next')['action']=='repair'
        (repo/'value.txt').write_text('ok\n'); commit(repo,'fix: correct value')
        run(repo,binary,'candidate','submit','--task',str(task),'--sha','HEAD')
        context=run(repo,binary,'task','--task',str(task),'--review'); assert context['previous_candidate']
        run(repo,binary,'review','resolve','--task',str(task),'--finding',str(finding),'--resolution','resolved','--evidence','value.txt now contains ok')
        run(repo,binary,'review','finish','--task',str(task),'--verdict','pass')
        assert run(repo,binary,'next')['action']=='final_review'
        print(json.dumps({'status':'PASS','straight_through':True,'single_repair':True},indent=2))

if __name__=='__main__': main()
