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
        self.assertIn("explorer", cfg["models"])
        self.assertIn("prepare", cfg["models"])
        self.assertIn("builder_retry", cfg["models"])
        self.assertNotIn("max_review_repairs", cfg["build"])

    def test_state_is_file_based_and_minimal(self):
        workflow = (ROOT / "WORKFLOW.md").read_text()
        self.assertIn("progress.toon", workflow)
        self.assertIn("ship.toon", workflow)
        self.assertIn("Git is implementation truth", workflow)
        self.assertIn("repairs/R001.toon", workflow)
        self.assertNotIn("workflow.sqlite", workflow)
        self.assertNotIn("dev-project", workflow)

    def test_human_review_surface_is_rich_pi_not_html(self):
        workflow = (ROOT / "WORKFLOW.md").read_text()
        ext = (ROOT / "dotfiles/.pi/agent/extensions/dev-workflow.ts").read_text()
        self.assertIn("modern web review page", workflow)
        self.assertIn("handleMouse(event)", ext)
        self.assertIn("new Image(", ext)
        self.assertIn("new Markdown(", ext)
        self.assertIn('name: "workflow_brief"', ext)
        self.assertNotIn("Lavish", workflow)

    def test_manual_skills_are_compact_and_single_purpose(self):
        skills = ROOT / "dotfiles/.agents/skills"
        expected = {"dev-spec", "dev-plan", "dev-prepare", "dev-review"}
        self.assertEqual({p.name for p in skills.iterdir() if p.is_dir()}, expected)
        for name in expected:
            text = (skills / name / "SKILL.md").read_text()
            self.assertLess(len(text.encode()), 2000)
            self.assertNotIn("DEV_WORKFLOW_SHIP", text)

        prepare = (skills / "dev-prepare/SKILL.md").read_text()
        review = (skills / "dev-review/SKILL.md").read_text()
        self.assertIn("Do not invent product changes", prepare)
        self.assertIn("terminal CI/checks", review)
        self.assertIn("repairs/RNNN.toon", review)

    def test_ship_loop_is_small_deterministic_outer_control(self):
        workflow = (ROOT / "WORKFLOW.md").read_text()
        ext = (ROOT / "dotfiles/.pi/agent/extensions/dev-workflow.ts").read_text()
        for phase in ["build", "prepare", "await", "review", "human", "blocked", "done"]:
            self.assertIn(f'"{phase}"', ext)
        self.assertIn("async function awaitShipSignals", ext)
        self.assertIn("--force-with-lease", ext)
        self.assertIn("approved_head", ext)
        self.assertNotIn("DEV_WORKFLOW_SHIP", ext)
        self.assertIn("shipReviewerSystem", ext)
        self.assertIn("finalizerSystem", ext)
        self.assertIn("fs.renameSync(temp, file)", ext)
        self.assertIn("No orchestrator agent", workflow)
        self.assertIn("No model tokens are consumed while waiting", workflow)

    def test_explorer_is_read_only_and_parallel(self):
        ext = (ROOT / "dotfiles/.pi/agent/extensions/dev-workflow.ts").read_text()
        self.assertIn("max_parallel", ext)
        self.assertIn("Promise.all", ext)
        self.assertIn("Explorer is read-only", ext)
        self.assertIn("compact result", ext)


if __name__ == "__main__":
    unittest.main()
