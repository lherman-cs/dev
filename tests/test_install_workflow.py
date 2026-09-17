#!/usr/bin/env python3
"""Filesystem checks for safe workflow asset migration; no network or live Codex."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('installer',ROOT/'scripts/install_workflow.py')
installer=importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)

class InstallTests(unittest.TestCase):
    def test_install_preserves_config_and_unrelated_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp); (target/'.codex/agents').mkdir(parents=True)
            config=target/'.codex/config.toml'; config.write_text('# untouched\n')
            unrelated=target/'.codex/agents/custom.toml'; unrelated.write_text('mine')
            result=installer.install(target)
            expected=sum(1 for d in ('dotfiles/.codex/agents','dotfiles/.agents/skills') for p in (ROOT/d).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
            self.assertEqual(len(result['changed']),expected)
            self.assertEqual(config.read_text(),'# untouched\n'); self.assertEqual(unrelated.read_text(),'mine')
            self.assertTrue((target/'.agents/skills/dev-spec/SKILL.md').exists())
            self.assertTrue((target/'.agents/skills/dev-project/SKILL.md').exists())
            self.assertFalse((target/'.agents/skills/dev-project/scripts').exists())
            self.assertFalse((target/'.agents/skills/dev-project/prompts').exists())
            self.assertFalse(result['backed_up']); self.assertFalse(installer.install(target)['changed'])

    def test_removes_old_workflow_support_dirs_with_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)
            for rel in installer.LEGACY_PATHS:
                path=target/rel
                path.mkdir(parents=True)
                (path/'sentinel').write_text(str(rel))
            result=installer.install(target)
            self.assertEqual(set(result['removed']),{str(p) for p in installer.LEGACY_PATHS})
            for rel in installer.LEGACY_PATHS:
                self.assertFalse((target/rel).exists())
                self.assertEqual((Path(result['backup_path'])/rel/'sentinel').read_text(),str(rel))
            again=installer.install(target)
            self.assertEqual(again['removed'],[]); self.assertEqual(again['changed'],[])

    def test_dry_run_does_not_remove_legacy_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp); path=target/installer.LEGACY_PATHS[1]
            path.mkdir(parents=True); (path/'old').write_text('old')
            result=installer.install(target,dry_run=True)
            self.assertIn(str(installer.LEGACY_PATHS[1]),result['removed'])
            self.assertEqual((path/'old').read_text(),'old'); self.assertFalse((target/'.codex').exists())

    def test_changes_back_up_previous_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp); installer.install(target)
            role=target/'.codex/agents/builder.toml'; role.write_text('old custom contents')
            result=installer.install(target)
            self.assertEqual(result['changed'],['.codex/agents/builder.toml'])
            self.assertEqual((Path(result['backup_path'])/'.codex/agents/builder.toml').read_text(),'old custom contents')

    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp); result=installer.install(target,dry_run=True)
            self.assertTrue(result['changed']); self.assertEqual(list(target.iterdir()),[])

    def test_missing_target_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError): installer.install(Path(tmp)/'missing')

    def test_symlink_parent_is_rejected_before_any_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'target'; outside=Path(tmp)/'outside'; target.mkdir(); outside.mkdir()
            (target/'.agents').symlink_to(outside,target_is_directory=True)
            with self.assertRaisesRegex(ValueError,'symlinked'): installer.install(target)
            self.assertEqual(list(outside.iterdir()),[]); self.assertFalse((target/'.codex').exists())

    def test_individual_symlink_is_backed_up_not_followed(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'target'; target.mkdir(); outside=Path(tmp)/'outside'; outside.write_text('external')
            dest=target/'.codex/agents/builder.toml'; dest.parent.mkdir(parents=True); dest.symlink_to(outside)
            result=installer.install(target)
            self.assertEqual(outside.read_text(),'external'); self.assertFalse(dest.is_symlink())
            self.assertTrue((Path(result['backup_path'])/'.codex/agents/builder.toml').is_symlink())

    def test_legacy_symlink_is_not_followed_on_removal(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'target'; target.mkdir(); outside=Path(tmp)/'outside'; outside.mkdir(); (outside/'sentinel').write_text('external')
            rel=installer.LEGACY_PATHS[1]; dest=target/rel
            dest.parent.mkdir(parents=True); dest.symlink_to(outside,target_is_directory=True)
            result=installer.install(target)
            self.assertFalse(dest.exists()); self.assertEqual((outside/'sentinel').read_text(),'external')
            self.assertTrue((Path(result['backup_path'])/rel).is_symlink())

if __name__=='__main__': unittest.main()
