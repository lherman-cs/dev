#!/usr/bin/env python3
"""Real filesystem tests for the optional workflow exporter; no Rust/LLM required."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', ROOT/'scripts/install_workflow.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class InstallTests(unittest.TestCase):
    def test_install_preserves_config_and_unrelated_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp); (target/'.codex').mkdir()
            config = target/'.codex/config.toml'; config.write_text('# untouched\n')
            unrelated = target/'.codex/agents/custom.toml'; unrelated.parent.mkdir()
            unrelated.write_text('mine')
            result = installer.install(target)
            self.assertEqual(len(result['changed']),18)
            self.assertEqual(config.read_text(),'# untouched\n')
            self.assertEqual(unrelated.read_text(),'mine')
            self.assertTrue((target/'.agents/skills/dev-spec/SKILL.md').exists())
            self.assertFalse(result['backed_up'])
            self.assertFalse(installer.install(target)['changed'])

    def test_changes_back_up_previous_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp); installer.install(target)
            role=target/'.codex/agents/builder.toml'; role.write_text('old custom contents')
            result=installer.install(target)
            self.assertEqual(result['changed'],['.codex/agents/builder.toml'])
            self.assertEqual((Path(result['backup_path'])/'.codex/agents/builder.toml').read_text(),'old custom contents')
            self.assertIn('model =',role.read_text())

    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp); result=installer.install(target,dry_run=True)
            self.assertEqual(len(result['changed']),18)
            self.assertFalse(list(target.iterdir()))

    def test_missing_target_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                installer.install(Path(tmp)/'missing')

    def test_symlink_parent_is_rejected_before_any_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp); target=base/'target'; outside=base/'outside'
            target.mkdir(); outside.mkdir()
            (target/'.agents').symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'symlinked'):
                installer.install(target)
            self.assertEqual(list(outside.iterdir()), [])
            self.assertFalse((target/'.codex').exists())

    def test_individual_symlink_is_backed_up_not_followed(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp); target=base/'target'; target.mkdir()
            outside=base/'outside.toml'; outside.write_text('external original')
            dest=target/'.codex/agents/builder.toml'; dest.parent.mkdir(parents=True)
            dest.symlink_to(outside)
            result=installer.install(target)
            self.assertEqual(outside.read_text(), 'external original')
            self.assertFalse(dest.is_symlink())
            saved=Path(result['backup_path'])/'.codex/agents/builder.toml'
            self.assertTrue(saved.is_symlink())
            self.assertEqual(saved.read_text(), 'external original')

if __name__=='__main__':
    unittest.main()
