"""Lightweight repository checks, not a runtime gate or proof of agent behavior."""
from pathlib import Path
import re
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "dotfiles/.agents/skills"


class Assets(unittest.TestCase):
    def test_four_skills_within_physical_line_budget(self):
        for name in ("dev-plan", "dev-build", "dev-review", "dev-project"):
            text = (SKILLS / name / "SKILL.md").read_text()
            self.assertLessEqual(len(text.splitlines()), 100, name)
            self.assertTrue(text.startswith("---\n"), name)
            self.assertIn(f"\nname: {name}\n", text)
            self.assertRegex(text.split("---", 2)[1], r"\ndescription: .+")

    def test_referenced_policy_files_exist(self):
        for file in SKILLS.glob("*/SKILL.md"):
            for ref in re.findall(r"`([^`]*references/[^`]+\.md)`", file.read_text()):
                self.assertTrue((file.parent / ref).is_file(), f"{file}: {ref}")

    def test_configs_parse_and_model_choices_are_coherent(self):
        config = tomllib.loads((ROOT / "agent.toml").read_text())
        names = {"builder": "build", "reviewer": "review", "planner": "plan"}
        for path in (ROOT / "dotfiles/.codex/agents").glob("*.toml"):
            role = tomllib.loads(path.read_text())
            self.assertEqual(role["name"], path.stem)
            self.assertTrue(role["developer_instructions"].strip())
            if path.stem in names:
                for key in ("model", "model_reasoning_effort"):
                    self.assertEqual(role[key], config["profiles"][names[path.stem]][key])

    def test_no_custom_workflow_hook_or_runtime_gate(self):
        source = (ROOT / "src/main.rs").read_text()
        for token in ("workflow_gate", "workflow_hook_args", "_workflow-hook", "DEV_WORKFLOW_", "mod project;"):
            self.assertNotIn(token, source)
        self.assertFalse((ROOT / "scripts/workflow_gate.py").exists())
        self.assertFalse((ROOT / "src/project").exists())

    def test_project_prompt_is_forwarded_without_metadata_preflight(self):
        source = (ROOT / "src/main.rs").read_text()
        body = source.split("fn exec_codex(profile:", 1)[1].split("\nfn ", 1)[0]
        self.assertIn('Command::new("codex")', body)
        self.assertIn('prompt.join(" ")', body)
        self.assertIn('Some(skill) => format!("{skill} {prompt}")', body)
        self.assertNotIn("read_to_string", body)
        self.assertNotIn("canonicalize", body)
        self.assertNotIn("python", body)

    def test_resume_does_not_select_a_profile(self):
        source = (ROOT / "src/main.rs").read_text()
        body = source.split("fn exec_codex_resume()", 1)[1].split("\nfn ", 1)[0]
        self.assertIn("agent_codex_overlay_args", body)
        self.assertNotIn("AgentProfileName::", body)
        self.assertNotIn("agent_codex_args(", body)
        self.assertIn('command.arg("resume")', body)

    def test_no_obsolete_injected_protocol_in_instructions(self):
        paths = list(SKILLS.rglob("*.md")) + list((ROOT / "dotfiles/.codex/agents").glob("*.toml"))
        for path in paths:
            text = path.read_text()
            for token in ("gate-injected", "injected Attempt", "Snapshot:", "Attempt:", "exact-snapshot", "hook-observed", "`.proposal/`"):
                self.assertNotIn(token, text, str(path))

    def test_justfile_keeps_install_binary_only(self):
        text = (ROOT / "justfile").read_text()
        self.assertIn("workflow-test:", text)
        self.assertIn("verify: workflow-test check test", text)
        install = text.split("\ninstall:\n", 1)[1].strip()
        self.assertEqual(install, "cargo install --path . --locked")
        self.assertNotIn("pip", text)
        self.assertNotIn("install.sh", text)


if __name__ == "__main__":
    unittest.main()
