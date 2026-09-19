import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PiWorkflowAssets(unittest.TestCase):
    def test_model_policy_is_explicit_but_replaceable(self):
        cfg = json.loads((ROOT / "dotfiles/.pi/agent/dev-workflow.json").read_text())
        self.assertEqual(cfg["build"]["max_attempts_per_plan"], 2)
        self.assertEqual(cfg["explorer"]["max_parallel"], 4)
        self.assertEqual(cfg["ship"]["max_repair_rounds"], 2)
        self.assertGreaterEqual(cfg["ship"]["poll_seconds"], 5)
        self.assertIn("builder_retry", cfg["models"])
        self.assertIn("review", cfg["models"])
        self.assertIn("ship", cfg["models"])

    def test_state_is_file_based_and_minimal(self):
        workflow = (ROOT / "WORKFLOW.md").read_text()
        self.assertIn("progress.toon", workflow)
        self.assertIn("ship.toon", workflow)
        self.assertIn("Git is implementation truth", workflow)
        self.assertNotIn("workflow.sqlite", workflow)

    def test_instruction_architecture_uses_least_privilege(self):
        root_agents = (ROOT / "AGENTS.md").read_text()
        global_agents = (ROOT / "dotfiles/.pi/agent/AGENTS.md").read_text()
        ext = (ROOT / "dotfiles/.pi/agent/extensions/dev-workflow.ts").read_text()

        for invariant in [
            "No duplication or contradiction",
            "Least-privilege scope",
            "Do not teach defaults",
        ]:
            self.assertIn(invariant, root_agents)

        self.assertLess(len(global_agents.encode()), 500)
        for generic in [
            "Fix root causes",
            "simplest durable design",
            "Tests must be",
            "quality, simplicity, robustness",
        ]:
            self.assertNotIn(generic, global_agents)

        self.assertNotIn("builderSystem", ext)
        self.assertIn('readSkill("dev-implement")', ext)
        self.assertIn('readSkill("dev-review")', ext)
        self.assertNotIn("DEV_WORKFLOW_SHIP", ext)

    def test_skills_are_compact_and_role_specific(self):
        skills = ROOT / "dotfiles/.agents/skills"
        expected = {"dev-spec", "dev-plan", "dev-implement", "dev-prepare", "dev-review"}
        self.assertEqual({p.name for p in skills.iterdir() if p.is_dir()}, expected)
        content = {name: (skills / name / "SKILL.md").read_text() for name in expected}

        for text in content.values():
            self.assertLess(len(text.encode()), 2000)
            self.assertNotIn("DEV_WORKFLOW_SHIP", text)

        spec = content["dev-spec"]
        self.assertIn("Challenge ambiguity", spec)
        self.assertIn("human decides", spec)
        self.assertIn("open decisions", spec)

        plan = content["dev-plan"]
        self.assertIn("Git reality outranks stale workflow pointers", plan)
        self.assertIn("independently testable", plan)
        self.assertIn("Dispatched plans are immutable", plan)
        self.assertIn("supersedes", plan)
        self.assertIn("not ordinary debugging", plan)
        self.assertNotIn("Conventional Commit", plan)

        implement = content["dev-implement"]
        self.assertIn("Conventional Commit", implement)
        self.assertIn("workflow IDs/metadata out of the commit message", implement)
        self.assertIn("NEEDS_REPLAN", implement)
        self.assertIn("controller-owned Git operations", implement)
        self.assertNotIn("Fix root causes", implement)
        self.assertNotIn("Tests must", implement)

        prepare = content["dev-prepare"]
        self.assertIn("all approved plans/repairs complete", prepare)
        self.assertIn("mechanical/minimal", prepare)
        self.assertIn("draft", prepare)

        review = content["dev-review"]
        self.assertIn("Red CI is evidence", review)
        self.assertIn("bounded/adversarial but conservative", review)
        self.assertIn("PASS means no material issue found", review)
        self.assertIn("stable root-cause key", review)
        self.assertNotIn("workflow_brief", review)

    def test_controller_owns_mechanics_not_role_semantics(self):
        ext = (ROOT / "dotfiles/.pi/agent/extensions/dev-workflow.ts").read_text()
        for phase in ["build", "prepare", "await", "review", "human", "blocked", "done"]:
            self.assertIn(f'"{phase}"', ext)

        self.assertIn("CONVENTIONAL_COMMIT_RE", ext)
        self.assertIn("commit message leaks workflow ID", ext)
        self.assertNotIn("Plan-ID:", ext)
        self.assertIn("async function awaitShipSignals", ext)
        self.assertIn("--force-with-lease", ext)
        self.assertIn("approved_head", ext)
        self.assertIn("fs.renameSync(temp, file)", ext)

        self.assertIn("This is the manual review command.", ext)
        self.assertIn("Present one workflow_brief", ext)
        self.assertIn("deselect/filter", ext)

    def test_human_review_surface_and_explorer(self):
        workflow = (ROOT / "WORKFLOW.md").read_text()
        ext = (ROOT / "dotfiles/.pi/agent/extensions/dev-workflow.ts").read_text()
        self.assertIn("modern web review page", workflow)
        self.assertIn("handleMouse(event)", ext)
        self.assertIn("new Image(", ext)
        self.assertIn('name: "workflow_brief"', ext)
        self.assertIn("Promise.all", ext)
        self.assertIn("Explorer is read-only", ext)
        self.assertIn("No model tokens are consumed while waiting", workflow)


if __name__ == "__main__":
    unittest.main()
