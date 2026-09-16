#!/usr/bin/env python3
"""Real Git/filesystem regression tests for bounded packaging and handoffs."""
from __future__ import annotations
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
TOOLS=ROOT/'dotfiles/.agents/skills/dev-project/scripts'
sys.path.insert(0,str(TOOLS))
import package_task
import package_review
import prepare_workspace
import review_report
import validate_workflow as validate

class WorkflowToolsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.repo=Path(self.tmp.name)/'repo'; self.repo.mkdir()
        self.git('init','-q'); self.git('config','user.email','test@example.com'); self.git('config','user.name','Test')
        (self.repo/'source').write_text('base\n'); self.git('add','source'); self.git('commit','-qm','base')
        self.base=self.git('rev-parse','HEAD')
        (self.repo/'source').write_text('candidate\n'); self.git('commit','-qam','candidate')
        self.candidate=self.git('rev-parse','HEAD')
        self.contract=self.repo/'brief.md'; self.contract.write_text('<!-- dev-contract: ' + json.dumps(dict(schema=1,kind='task',base=self.base)) + ' -->\nRetry without losing state.\n')
        self.package=self.repo/'diff.md'
        self.package.write_text(package_review.render(self.repo,self.base,self.candidate,self.contract)[0])

    def git(self,*args):
        return subprocess.check_output(['git','-C',str(self.repo),*args],text=True,stderr=subprocess.PIPE).strip()

    def cli(self,name,*args):
        return subprocess.run([sys.executable,str(TOOLS/name),*map(str,args)],text=True,capture_output=True)

    def build_report(self):
        path=self.repo/'build.md'
        path.write_text(f'Status: COMPLETED\nCommit: {self.candidate}\nVerification-Status: PASS\nVerification:\n- focused test -> PASS\n')
        return path

    def project(self):
        path=self.repo/'plans/p'; path.mkdir(parents=True)
        (path/'work').mkdir(); (path/'spec.md').write_text('Status: APPROVED\nRequire retries.\n')
        (path/'plan.md').write_text('Status: READY\n### Task 1: Retry\nImplement retries.\n')
        (path/'progress.md').write_text('## Tasks\n- 1: PENDING\n')
        return path

    def review(self,**changes):
        data=dict(schema=2,package_sha256=review_report.digest(self.package),mode='task',base=self.base,candidate=self.candidate,
                  contract_sha256=review_report.digest(self.contract),verdict='PASS',findings=[],
                  resolutions=[],checked=['source:1 behavior and test inspected'],blocker='')
        data.update(changes)
        path=self.repo/'review.json'; path.write_text(json.dumps(data)); return path

    def reviews_cli(self,path,*extra):
        return self.cli('validate_workflow.py','reviews','--repo',self.repo,'--base',self.base,
                        '--candidate',self.candidate,'--contract',self.contract,'--mode','task','--package',self.package,'--report',path,*extra)

    def test_task_extracts_only_requested_task(self):
        plan='# Plan\nStatus: READY\n### Task 1: First\nDo A.\n### Task 2: Second\nDo B.\n'
        self.assertIn('Do A.',package_task.extract(plan,'1')); self.assertNotIn('Do B.',package_task.extract(plan,'1'))
        self.assertIn('Do B.',package_task.extract(plan,'2'))
        with self.assertRaises(ValueError): package_task.extract(plan,'3')

    def test_ambiguous_task_ids_rejected(self):
        with self.assertRaisesRegex(ValueError,'Duplicate task IDs'):
            package_task.extract('### Task 1a: First\nA\n### Task 1A: Second\nB\n','1a')

    def test_final_validation_not_absorbed_but_local_notes_retained(self):
        plan='### Task 1: Build\nImplement.\n### Notes\nLocal detail.\n#### Verification\nFocused.\n## Final validation\nEverything.\n'
        brief=package_task.extract(plan,'1')
        self.assertIn('Local detail.',brief); self.assertIn('Focused.',brief); self.assertNotIn('Everything.',brief)

    def test_fenced_examples_not_treated_as_boundaries(self):
        plan='### Task 1: Document\n```markdown\n### Task 1: Example\n## Example\n```\n~~~markdown\n### Task 2: Example\n~~~\nStill first.\n### Task 2: Next\nNext.\n'
        text=package_task.extract(plan,'1'); self.assertIn('Still first.',text); self.assertNotIn('Next.',text)
        self.assertEqual(package_task.extract(plan,'2'),'### Task 2: Next\nNext.\n')

    def test_duplicate_constraints_rejected(self):
        with self.assertRaisesRegex(ValueError,'Duplicate Global'):
            package_task.constraints('## Global Constraints\nA\n## Global Constraints\nB\n')

    def test_index_excludes_task_bodies(self):
        plan=self.repo/'plan.md'
        plan.write_text('# Plan\n## Global Constraints\nExact value: 42.\n## Tasks\n### Task 1: First\nLARGE BODY NOT FOR CONTROLLER\n### Task 2: Second\nOTHER BODY\n')
        result=self.cli('package_task.py','--plan',plan,'--list')
        self.assertEqual(result.returncode,0,result.stderr)
        data=json.loads(result.stdout)
        self.assertEqual(data['tasks'],['### Task 1: First','### Task 2: Second'])
        self.assertIn('Exact value: 42.',data['constraints']); self.assertNotIn('LARGE BODY',result.stdout)

    def test_split_package_preserves_contract_and_previous_brief(self):
        plan=self.repo/'plan.md'; original='# Plan\n## Global Constraints\nFloor: 42\n## Tasks\n### Task 1: Transaction\nValidate. Publish.\n### Task 2: Client\nConnect.\n'
        plan.write_text(original); first=self.repo/'first.md'; unit=self.repo/'unit.md'
        args=['--plan',plan,'--task','1','--base',self.base,'--report',self.repo/'build.md']
        result=self.cli('package_task.py',*args,'--output',first); self.assertEqual(result.returncode,0,result.stderr)
        first_bytes=first.read_bytes(); scope='1a: validation only; publication is assigned to 1b; preserve interface X.'
        result=self.cli('package_task.py',*args,'--output',unit,'--scope',scope)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(plan.read_text(),original); self.assertEqual(first.read_bytes(),first_bytes)
        self.assertIn('Floor: 42',unit.read_text()); self.assertIn(scope,unit.read_text()); self.assertNotIn('Connect.',unit.read_text())
        self.assertEqual(json.loads(result.stdout)['contract_sha256'],review_report.digest(unit))
        before=unit.read_bytes(); result=self.cli('package_task.py',*args,'--output',unit)
        self.assertNotEqual(result.returncode,0); self.assertEqual(unit.read_bytes(),before)

    def test_empty_scope_rejected_before_output(self):
        plan=self.repo/'plan.md'; plan.write_text('### Task 1: Work\nA\n'); output=self.repo/'out'
        result=self.cli('package_task.py','--plan',plan,'--task','1','--base',self.base,'--report','x','--output',output,'--scope',' ')
        self.assertNotEqual(result.returncode,0); self.assertFalse(output.exists())

    def test_final_contract_is_a_frozen_snapshot(self):
        p=self.project(); output=p/'work/final.md'
        result=self.cli('package_task.py','--plan',p/'plan.md','--spec',p/'spec.md','--progress',p/'progress.md',
                        '--final','--base',self.base,'--report',self.build_report(),'--output',output)
        self.assertEqual(result.returncode,0,result.stderr)
        frozen=output.read_bytes(); (p/'progress.md').write_text('later ledger state')
        self.assertEqual(output.read_bytes(),frozen)
        self.assertIn('Require retries.',output.read_text()); self.assertIn('Implement retries.',output.read_text())
        self.assertEqual(json.loads(result.stdout)['contract_sha256'],review_report.digest(output))

    def test_final_snapshot_requires_approved_authorities(self):
        p=self.project(); (p/'spec.md').write_text('Status: DRAFT\n')
        result=self.cli('package_task.py','--plan',p/'plan.md','--spec',p/'spec.md','--progress',p/'progress.md',
                        '--final','--base',self.base,'--report','x','--output',p/'work/final.md')
        self.assertNotEqual(result.returncode,0); self.assertFalse((p/'work/final.md').exists())

    def test_project_ready_markers(self):
        p=self.project(); self.assertEqual(validate.check_project(p)['status'],'PASS')
        for content in ['Status: DRAFT\n','Status: APPROVED\nStatus: APPROVED\n']:
            (p/'spec.md').write_text(content)
            with self.assertRaises(ValueError): validate.check_project(p)

    def test_duplicate_ledger_tasks_rejected_without_mutation(self):
        p=self.project(); progress=p/'progress.md'; text='## Tasks\n- 5d: ACCEPTED\n- Task 5D: PENDING\n'
        progress.write_text(text)
        with self.assertRaisesRegex(ValueError,'Duplicate task'): validate.check_project(p)
        self.assertEqual(progress.read_text(),text)
        progress.write_text('## Tasks\n- Task 5: PENDING\n  - 5d: ACCEPTED\n## Rulings\n- 5d: not a task row\n')
        self.assertEqual(validate.check_project(p)['status'],'PASS')

    def test_candidate_report_matches_git_boundary(self):
        report=self.build_report()
        self.assertEqual(validate.check_candidate(self.repo,self.base,self.candidate,report)['candidate'],self.candidate)
        for value in ['pending',self.base,self.candidate+'\nCommit: '+self.candidate]:
            report.write_text(f'Status: COMPLETED\nCommit: {value}\nVerification-Status: PASS\nVerification: focused pass\n')
            before=report.read_bytes(); result=self.cli('validate_workflow.py','build-handoff','--repo',self.repo,'--report',report)
            self.assertNotEqual(result.returncode,0); self.assertEqual(report.read_bytes(),before)
            self.assertEqual(self.git('rev-parse','HEAD'),self.candidate)
        report.write_text(f'Status: COMPLETED\nCommit: {self.candidate[:10]}\nVerification-Status: PASS\nVerification:\n- focused pass\n')
        self.assertEqual(self.cli('validate_workflow.py','build-handoff','--repo',self.repo,'--report',report).returncode,0)

    def test_empty_verification_rejected(self):
        report=self.build_report(); report.write_text(f'Status: COMPLETED\nCommit: {self.candidate}\nVerification-Status: PASS\nVerification:\n')
        with self.assertRaisesRegex(ValueError,'nonempty Verification'): validate.check_build_report(self.repo,self.candidate,report)

    def test_dirty_candidate_cannot_use_clean_report(self):
        report=self.build_report(); (self.repo/'source').write_text('unreviewed')
        with self.assertRaisesRegex(ValueError,'Tracked checkout changes'):
            validate.check_candidate(self.repo,self.base,self.candidate,report)

    def test_index_changes_also_invalidate_candidate(self):
        report=self.build_report(); (self.repo/'new').write_text('unreviewed'); self.git('add','new')
        with self.assertRaisesRegex(ValueError,'Tracked checkout changes'):
            validate.check_candidate(self.repo,self.base,self.candidate,report)

    def test_review_package_full_range_and_immutable(self):
        (self.repo/'second').write_text('second change\n'); self.git('add','second'); self.git('commit','-qm','second')
        candidate=self.git('rev-parse','HEAD'); out=self.repo/'package.md'
        args=['--repo',self.repo,'--base',self.base,'--candidate',candidate,'--brief',self.contract,'--output',out]
        result=self.cli('package_review.py',*args); self.assertEqual(result.returncode,0,result.stderr)
        text=out.read_text(); self.assertIn('-base',text); self.assertIn('+candidate',text); self.assertIn('+second change',text)
        meta=json.loads(result.stdout); self.assertEqual(meta['contract_sha256'],review_report.digest(self.contract))
        self.assertNotIn('second change',result.stdout)
        before=out.read_bytes(); result=self.cli('package_review.py',*args)
        self.assertNotEqual(result.returncode,0); self.assertEqual(out.read_bytes(),before)

    def test_external_diff_and_textconv_not_executed(self):
        self.git('config','diff.external','nonexistent-helper-must-not-run')
        self.git('config','diff.custom.textconv','nonexistent-textconv-must-not-run')
        (self.repo/'.gitattributes').write_text('source diff=custom\n')
        result=self.cli('package_review.py','--repo',self.repo,'--base',self.base,'--candidate',self.candidate,'--output',self.repo/'package.md')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('+candidate',(self.repo/'package.md').read_text())

    def test_nonancestor_review_range_rejected(self):
        self.git('checkout','-q','--orphan','other'); self.git('rm','-rf','--cached','.')
        (self.repo/'other').write_text('other'); self.git('add','other'); self.git('commit','-qm','other root')
        out=self.repo/'invalid.md'
        result=self.cli('package_review.py','--repo',self.repo,'--base',self.base,'--candidate','HEAD','--output',out)
        self.assertNotEqual(result.returncode,0); self.assertFalse(out.exists())

    def test_review_cli_only_returns_small_validated_envelope(self):
        result=self.reviews_cli(self.review()); self.assertEqual(result.returncode,0,result.stderr)
        data=json.loads(result.stdout); self.assertEqual(data['status'],'VALID'); self.assertEqual(data['verdict'],'PASS')
        self.assertNotIn('behavior and test inspected',result.stdout)

    def test_review_rejects_stale_candidate_or_checkout(self):
        result=self.reviews_cli(self.review(candidate=self.base))
        self.assertNotEqual(result.returncode,0)
        path=self.review(); self.git('commit','--allow-empty','-qm','moved checkout')
        result=self.reviews_cli(path); self.assertNotEqual(result.returncode,0); self.assertIn('HEAD',result.stderr)

    def test_verdict_only_legacy_report_cannot_approve(self):
        p=self.repo/'old.md'; p.write_text('Verdict: PASS\n')
        with self.assertRaisesRegex(ValueError,'legacy verdict-only'): validate.check_reviews([p])
        self.assertNotEqual(self.reviews_cli(p).returncode,0)

    def test_multiple_reports_are_not_multiple_mandatory_review_seats(self):
        p=self.review()
        with self.assertRaisesRegex(ValueError,'One review report'):
            validate.check_reviews([p,p],repo=self.repo,base=self.base,candidate=self.candidate,contract=self.contract,mode='task')

    def test_repair_packet_generated_exactly_and_exclusively(self):
        f=dict(id='R1',severity='Important',origin='candidate',location='source:1',
               failure='trigger → broken behavior',impact='lost data',resolution='check cursor')
        p=self.review(verdict='FIXES_REQUIRED',findings=[f]); out=self.repo/'repair.json'
        result=self.reviews_cli(p,'--repair-output',out); self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(out.read_text())['findings'],[f])
        self.assertEqual(json.loads(result.stdout)['verdict'],'FIXES_REQUIRED')
        self.assertNotIn('lost data',result.stdout)
        before=out.read_bytes(); result=self.reviews_cli(p,'--repair-output',out)
        self.assertNotEqual(result.returncode,0); self.assertEqual(out.read_bytes(),before)

    def test_linked_worktree_ignore_and_index_guards(self):
        linked=Path(self.tmp.name)/'linked'; self.git('worktree','add','-qb','linked',str(linked))
        self.assertEqual(prepare_workspace.prepare(linked)['status'],'PASS')
        exclude=Path(self.git('rev-parse','--path-format=absolute','--git-path','info/exclude'))
        before=exclude.read_bytes(); prepare_workspace.prepare(linked); self.assertEqual(exclude.read_bytes(),before)
        artifact=self.repo/'plans/p/work/report.md'; artifact.parent.mkdir(parents=True); artifact.write_text('local report')
        self.assertEqual(self.git('check-ignore',str(artifact)),str(artifact))
        self.git('add','-f',str(artifact))
        with self.assertRaisesRegex(ValueError,'staged'): validate.check_index(self.repo)
        with self.assertRaisesRegex(ValueError,'Already tracked'): prepare_workspace.prepare(self.repo)
        self.git('commit','-qm','bad artifact'); bad=self.git('rev-parse','HEAD')
        report=self.repo/'handoff'; report.write_text(f'Status: COMPLETED\nCommit: {bad}\nVerification-Status: PASS\nVerification: passed\n')
        with self.assertRaisesRegex(ValueError,'commits workflow artifacts'):
            validate.check_candidate(self.repo,self.base,bad,report)
        self.git('rm','--cached',str(artifact))
        self.assertEqual(validate.check_index(self.repo)['status'],'PASS')
        self.assertEqual(prepare_workspace.prepare(self.repo)['status'],'PASS')
        self.assertEqual(artifact.read_text(),'local report')

if __name__=='__main__': unittest.main()
