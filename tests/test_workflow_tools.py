#!/usr/bin/env python3
"""Deterministic tests for task/review packaging and mechanical workflow checks."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import subprocess
import sys
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

    def test_ambiguous_task_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate task IDs'):
            package_task.extract('### Task 1a: First\nA\n### Task 1A: Second\nB\n', '1a')

    def test_split_package_preserves_plan_and_dispatched_brief(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = root/'plan.md'
            original = '# Plan\nStatus: READY\n### Task 1: Transaction\nValidate input. Publish state.\n### Task 2: Client\nConnect.\n'
            plan.write_text(original)
            first, unit = root/'first.md', root/'unit-1a.md'
            command = [sys.executable, str(TOOLS/'package_task.py'), '--plan', str(plan),
                       '--task', '1', '--base', 'abc1234', '--report', str(root/'report.md')]
            subprocess.run([*command, '--output', str(first)], check=True, capture_output=True)
            dispatched = first.read_bytes()
            scope = '1a: validate input; publication belongs to 1b. Test validation before handoff.'
            subprocess.run([*command, '--output', str(unit), '--scope', scope], check=True, capture_output=True)
            self.assertEqual(plan.read_text(), original)
            self.assertEqual(first.read_bytes(), dispatched)
            self.assertIn(package_task.extract(original, '1').rstrip(), unit.read_text())
            self.assertIn(scope, unit.read_text())
            self.assertNotIn('Connect.', unit.read_text())
            before = unit.read_bytes()
            result = subprocess.run([*command, '--output', str(unit), '--scope', 'replace'], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(unit.read_bytes(), before)

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

            command = [sys.executable, str(TOOLS/'validate_workflow.py'), 'build-handoff',
                       '--repo', str(repo), '--report', str(report)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            for marker, message in [('pending', 'no parseable marker'),
                                    (base, 'does not match candidate'),
                                    (candidate + '\nCommit: ' + candidate, 'multiple markers')]:
                report.write_text(f'Status: COMPLETED\nCommit: {marker}\nVerification:\n- test -> PASS\n')
                before = report.read_bytes()
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)
                self.assertEqual(report.read_bytes(), before)
                self.assertEqual(subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'],text=True).strip(), candidate)

            report.write_text(f'Status: COMPLETED\nCommit: {candidate[:10]}\nVerification:\n- test -> PASS\n')
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


    def test_review_package_is_exact_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo=Path(tmp); subprocess.run(['git','init','-q',repo],check=True); subprocess.run(['git','-C',repo,'config','user.email','test@example.com'],check=True); subprocess.run(['git','-C',repo,'config','user.name','Test'],check=True)
            f=repo/'x'; f.write_text('a\n'); subprocess.run(['git','-C',repo,'add','x'],check=True); subprocess.run(['git','-C',repo,'commit','-qm','base'],check=True); base=subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'],text=True).strip()
            f.write_text('b\n'); subprocess.run(['git','-C',repo,'commit','-qam','candidate'],check=True); candidate=subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'],text=True).strip()
            out=repo/'package.md'
            command = [sys.executable, str(TOOLS/'package_review.py'), '--repo', str(repo),
                       '--base', base, '--candidate', candidate, '--output', str(out)]
            subprocess.run(command, check=True, capture_output=True)
            self.assertIn('-a',out.read_text()); self.assertIn('+b',out.read_text())
            self.assertIn(base, out.read_text()); self.assertIn(candidate, out.read_text())
            before = out.read_bytes()
            result = subprocess.run(command, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(out.read_bytes(), before)

    def test_review_verdict_parser(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'review.md'; p.write_text('Verdict: PASS\n'); self.assertEqual(validate.check_reviews([p])['verdicts'][str(p)],'PASS')

if __name__=='__main__': unittest.main()
