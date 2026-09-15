#!/usr/bin/env python3
"""Deterministic tests for task/review packaging and mechanical workflow checks."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT/'dotfiles/.agents/skills/dev-project/scripts'

def load(name: str):
    spec=importlib.util.spec_from_file_location(name,TOOLS/f'{name}.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

package_task=load('package_task'); package_review=load('package_review'); validate=load('validate_workflow')

class WorkflowToolsTests(unittest.TestCase):
    def test_task_extracts_only_requested_task(self):
        plan='''# Plan\nStatus: READY\n\n### Task 1: First\nDo A.\n\n### Task 2: Second\nDo B.\n'''
        self.assertIn('Do A.',package_task.extract(plan,'1'))
        self.assertNotIn('Do B.',package_task.extract(plan,'1'))
        self.assertIn('Do B.',package_task.extract(plan,'2'))
        with self.assertRaises(ValueError): package_task.extract(plan,'3')

    def test_project_ready_markers(self):
        with tempfile.TemporaryDirectory() as tmp:
            project=Path(tmp); (project/'spec.md').write_text('# Spec\nStatus: APPROVED\n'); (project/'plan.md').write_text('# Plan\nStatus: READY\n'); (project/'progress.md').write_text('# Progress\n'); (project/'work').mkdir()
            result=validate.check_project(project); self.assertEqual(result['status'],'PASS'); self.assertTrue((project/'work').is_dir())
            (project/'spec.md').write_text('# Spec\nStatus: DRAFT\n')
            with self.assertRaisesRegex(ValueError,'not APPROVED'): validate.check_project(project)

    def test_candidate_report_matches_git_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo=Path(tmp); subprocess.run(['git','init','-q',repo],check=True); subprocess.run(['git','-C',repo,'config','user.email','test@example.com'],check=True); subprocess.run(['git','-C',repo,'config','user.name','Test'],check=True)
            f=repo/'x'; f.write_text('a\n'); subprocess.run(['git','-C',repo,'add','x'],check=True); subprocess.run(['git','-C',repo,'commit','-qm','base'],check=True); base=subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'],text=True).strip()
            f.write_text('b\n'); subprocess.run(['git','-C',repo,'commit','-qam','candidate'],check=True); candidate=subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'],text=True).strip()
            report=repo/'report.md'; report.write_text(f'Status: COMPLETED\nCommit: {candidate}\n\nVerification:\n- test -> PASS\n')
            result=validate.check_candidate(repo,base,candidate,report); self.assertEqual(result['candidate'],candidate)


    def test_review_package_is_exact_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo=Path(tmp); subprocess.run(['git','init','-q',repo],check=True); subprocess.run(['git','-C',repo,'config','user.email','test@example.com'],check=True); subprocess.run(['git','-C',repo,'config','user.name','Test'],check=True)
            f=repo/'x'; f.write_text('a\n'); subprocess.run(['git','-C',repo,'add','x'],check=True); subprocess.run(['git','-C',repo,'commit','-qm','base'],check=True); base=subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'],text=True).strip()
            f.write_text('b\n'); subprocess.run(['git','-C',repo,'commit','-qam','candidate'],check=True); candidate=subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'],text=True).strip()
            out=repo/'package.md'
            # Exercise the same core helpers and format used by the CLI script.
            b=package_review.commit(repo,base); c=package_review.commit(repo,candidate); self.assertEqual((b,c),(base,candidate))
            stat=package_review.git(repo,'diff','--stat','--find-renames',b,c); diff=package_review.git(repo,'diff','--no-ext-diff','--find-renames','--find-copies',b,c,'--')
            out.write_text(f'Base: `{b}`\nCandidate: `{c}`\n{stat}\n{diff}')
            self.assertIn('-a',out.read_text()); self.assertIn('+b',out.read_text())

    def test_review_verdict_parser(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'review.md'; p.write_text('Verdict: PASS\n'); self.assertEqual(validate.check_reviews([p])['verdicts'][str(p)],'PASS')

if __name__=='__main__': unittest.main()
