#!/usr/bin/env python3
"""Real filesystem checks for safe migration; no network or live Codex."""
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
            custom=target/'.agents/skills/dev-project/prompts/custom.md'; custom.parent.mkdir(parents=True); custom.write_text('custom')
            result=installer.install(target)
            expected=sum(1 for d in ('dotfiles/.codex/agents','dotfiles/.agents/skills') for p in (ROOT/d).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
            self.assertEqual(len(result['changed']),expected)
            self.assertEqual(config.read_text(),'# untouched\n'); self.assertEqual(unrelated.read_text(),'mine')
            self.assertEqual(custom.read_text(),'custom')
            self.assertTrue((target/'.agents/skills/dev-spec/SKILL.md').exists())
            self.assertTrue((target/'.agents/skills/dev-project/prompts/task-review.md').exists())
            self.assertTrue((target/'.agents/skills/dev-project/scripts/review_report.py').exists())
            self.assertFalse(result['backed_up']); self.assertFalse(installer.install(target)['changed'])

    def test_removes_legacy_dev_explore_but_backs_it_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp); legacy=target/'.agents/skills/dev-explore'; legacy.mkdir(parents=True)
            (legacy/'SKILL.md').write_text('legacy')
            result=installer.install(target)
            self.assertEqual(result['removed'],['.agents/skills/dev-explore'])
            self.assertFalse(legacy.exists())
            self.assertEqual((Path(result['backup_path'])/'.agents/skills/dev-explore/SKILL.md').read_text(),'legacy')

    def test_all_retired_prompts_backed_up_and_removed(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)
            for rel in installer.LEGACY_PATHS[1:]:
                path=target/rel; path.parent.mkdir(parents=True,exist_ok=True); path.write_text(str(rel))
            result=installer.install(target)
            self.assertEqual(set(result['removed']),{str(p) for p in installer.LEGACY_PATHS[1:]})
            for rel in installer.LEGACY_PATHS[1:]:
                self.assertFalse((target/rel).exists())
                self.assertEqual((Path(result['backup_path'])/rel).read_text(),str(rel))
            again=installer.install(target)
            self.assertEqual(again['removed'],[]); self.assertEqual(again['changed'],[])

    def test_dry_run_does_not_delete_retired_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp); path=target/installer.LEGACY_PATHS[1]
            path.parent.mkdir(parents=True); path.write_text('old')
            result=installer.install(target,dry_run=True)
            self.assertIn(str(installer.LEGACY_PATHS[1]),result['removed'])
            self.assertEqual(path.read_text(),'old'); self.assertFalse((target/'.codex').exists())

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
            target=Path(tmp)/'target'; target.mkdir(); outside=Path(tmp)/'outside'; outside.write_text('external')
            rel=installer.LEGACY_PATHS[1]; dest=target/rel
            dest.parent.mkdir(parents=True); dest.symlink_to(outside)
            result=installer.install(target)
            self.assertFalse(dest.exists()); self.assertEqual(outside.read_text(),'external')
            self.assertTrue((Path(result['backup_path'])/rel).is_symlink())

    def test_preflight_prevents_partial_legacy_deletion(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp); old=target/installer.LEGACY_PATHS[1]
            old.parent.mkdir(parents=True); old.write_text('preserve')
            # An invalid later destination must be detected before the legacy removal.
            (target/'.codex/agents/builder.toml').mkdir(parents=True)
            with self.assertRaisesRegex(ValueError,'directory'): installer.install(target)
            self.assertEqual(old.read_text(),'preserve')

if __name__=='__main__': unittest.main()
