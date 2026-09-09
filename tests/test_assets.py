"""Asset and adapter contract checks; these do not replace Rust compilation or live Codex tests."""
import ast
from pathlib import Path
import re
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Assets(unittest.TestCase):
    def test_four_skills_within_physical_line_budget(self):
        for name in ("dev-plan", "dev-build", "dev-review", "dev-project"):
            text = (ROOT / "dotfiles/.agents/skills" / name / "SKILL.md").read_text()
            self.assertLessEqual(len(text.splitlines()), 100, name)
            self.assertTrue(text.startswith("---\n"), name)
            self.assertIn(f"\nname: {name}\n", text)
            self.assertRegex(text.split("---", 2)[1], r"\ndescription: .+")

    def test_referenced_policy_files_exist(self):
        for file in (ROOT / "dotfiles/.agents/skills").glob("*/SKILL.md"):
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
                profile = config["profiles"][names[path.stem]]
                for key in ("model", "model_reasoning_effort"):
                    self.assertEqual(role[key], profile[key], f"{path}: {key}")

    def test_python_is_valid_without_external_imports(self):
        allowed = {"__future__", "contextlib", "fcntl", "hashlib", "json", "os", "pathlib", "re", "subprocess", "sys", "tempfile", "uuid"}
        module = ast.parse((ROOT / "scripts/workflow_gate.py").read_text())
        for node in ast.walk(module):
            if isinstance(node, ast.Import):
                self.assertTrue(all(n.name in allowed for n in node.names))
            elif isinstance(node, ast.ImportFrom):
                self.assertIn(node.module, allowed)

    def test_gate_embedded_and_no_custom_scheduler(self):
        source = (ROOT / "src/main.rs").read_text()
        self.assertIn('include_str!("../scripts/workflow_gate.py")', source)
        self.assertIn('args.extend(workflow_hook_args()?)', source)
        self.assertIn('workflow_gate("prepare")', source)
        self.assertIn('workflow_gate("finish")', source)
        self.assertNotIn('mod project;', source)
        self.assertNotIn('dangerously-bypass-hook-trust', source)
        self.assertFalse((ROOT / "src/project").exists())

    def test_resume_does_not_select_a_profile(self):
        source = (ROOT / "src/main.rs").read_text()
        body = source.split("fn exec_codex_resume()", 1)[1].split("\nfn ", 1)[0]
        self.assertIn("agent_codex_overlay_args", body)
        self.assertNotIn("AgentProfileName::", body)
        self.assertNotIn("agent_codex_args(", body)
        self.assertIn('command.arg("resume")', body)
        self.assertIn('env_remove("DEV_WORKFLOW_PHASE")', body)

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
