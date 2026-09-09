#!/usr/bin/env python3
"""Black-box tests against a compiled dev binary and real temporary Git repositories.

Usage: python3 tests/runner_e2e.py --binary target/debug/dev
No API credentials or real Codex installation are used. Test fixtures are not semantic-quality benchmarks.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--binary", type=Path, required=True)
opts, remaining = parser.parse_known_args()
BINARY = opts.binary.resolve()
if not BINARY.is_file():
    parser.error(f"compiled dev binary not found: {BINARY}; run cargo build --locked first")
sys.argv = [sys.argv[0], *remaining]

class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dev-runner-e2e-")
        self.base = Path(self.temp.name)
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.data = self.base / "userdata"
        self.data.mkdir()
        self.fake_state = self.base / "fake.json"
        self.env = os.environ.copy()
        self.env.update({"XDG_DATA_HOME": str(self.data), "DEV_CODEX_BIN": str(HERE / "fake_codex.py"),
                         "FAKE_CODEX_STATE": str(self.fake_state), "FAKE_CODEX_SCENARIO": "repairs"})
        self.env.pop("DEV_WORKFLOW_MANAGED", None)
        for args in [("init", "-q"), ("config", "user.email", "fixture@example.invalid"), ("config", "user.name", "Fixture")]:
            self.git(*args)
        (self.repo / "value.txt").write_text("0\n")
        self.git("add", "value.txt")
        self.git("commit", "-qm", "baseline")
        self.project = self.repo / "plans/test"
        self.project.mkdir(parents=True)
        (self.project / "spec.md").write_text("O1: value.txt contains 4. Final fixtures also verify integration when declared.\n")
        (self.project / "01-behavior.md").write_text("Implement the required value and verify O1.\n")
        self.manifest = {"version": 1, "name": "fixture", "spec": "spec.md",
                         "obligations": [{"id": "O1", "text": "value and integrated behavior satisfy declared checks"}],
                         "plans": [{"id": "01-behavior", "file": "01-behavior.md", "depends_on": [], "obligations": ["O1"], "checks": ["C1"]}],
                         "checks": [{"id": "BASE", "argv": [sys.executable, "-c", "print('ready')"], "cwd": ".", "timeout_seconds": 5},
                                    {"id": "C1", "argv": [sys.executable, "-c", "from pathlib import Path; assert Path('value.txt').read_text().strip() == '4'"], "cwd": ".", "timeout_seconds": 5}],
                         "readiness_checks": ["BASE"], "final_checks": ["C1"]}
        self.write_manifest()
    def tearDown(self):
        self.temp.cleanup()
    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True).strip()
    def write_manifest(self):
        (self.project / "project.json").write_text(json.dumps(self.manifest))
    def call(self, *args, success=True):
        p = subprocess.run([str(BINARY), "a", "project", str(self.project), *args], cwd=self.repo,
                           env=self.env, text=True, capture_output=True, timeout=120)
        if success:
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        else:
            self.assertNotEqual(p.returncode, 0, p.stdout + p.stderr)
        return p
    def state(self):
        files = list((self.data / "dev/workflows").glob("*/state.json"))
        self.assertEqual(len(files), 1)
        return json.loads(files[0].read_text())
    def ready(self):
        status = self.call("--status")
        digest = next(line.split(": ", 1)[1] for line in status.stdout.splitlines() if line.startswith("Package: "))
        p = self.call("--check", "--approve", digest)
        self.assertIn("READY — NOT STARTED", p.stdout)
        return self.state()["digest"]
    def test_more_than_two_repairs_converge_with_persistent_workers(self):
        digest = self.ready()
        p = self.call("--approve", digest)
        self.assertIn("Status: COMPLETED", p.stdout)
        calls = json.loads(self.fake_state.read_text())["calls"]
        builders = [c for c in calls if c.get("mode") in ("IMPLEMENT_OR_REPAIR", "DIAGNOSE")]
        self.assertGreaterEqual(len([c for c in builders if c["mode"] == "IMPLEMENT_OR_REPAIR"]), 4)
        self.assertEqual(len({c["session"] for c in builders}), 1)
        self.assertGreaterEqual(len([c for c in calls if c.get("mode") == "DIAGNOSE"]), 2)
        initial_reviewers = [c for c in calls if c.get("mode") in ("INITIAL", "FOLLOWUP")]
        self.assertEqual(len({c["session"] for c in initial_reviewers}), 1)
        final = [c for c in calls if c.get("mode") == "FINAL"]
        self.assertNotEqual(final[0]["session"], initial_reviewers[0]["session"])
    def test_explicit_user_budget_pauses_then_resumes(self):
        digest = self.ready()
        p = self.call("--approve", digest, "--max-turns", "1")
        self.assertIn("PAUSED", p.stdout)
        self.assertNotEqual(self.state()["phase"], "Stopped")
        self.assertIn("COMPLETED", self.call().stdout)
    def test_invalid_revision_is_corrected_in_same_reviewer(self):
        self.env["FAKE_CODEX_SCENARIO"] = "bad_revision"
        digest = self.ready()
        self.assertIn("COMPLETED", self.call("--approve", digest).stdout)
        calls = json.loads(self.fake_state.read_text())["calls"]
        reviewers = [c for c in calls if c.get("mode") == "INITIAL"]
        self.assertGreaterEqual(len(reviewers), 2)
        self.assertEqual(reviewers[0]["session"], reviewers[1]["session"])
    def test_same_revision_counterevidence_is_not_forced_to_commit(self):
        self.env["FAKE_CODEX_SCENARIO"] = "counterevidence"
        digest = self.ready()
        self.assertIn("COMPLETED", self.call("--approve", digest).stdout)
        self.assertEqual(int(self.git("rev-list", "--count", "HEAD")), 2)
        self.assertEqual(self.state()["plans"]["01-behavior"]["build"]["verdict"], "NO_CHANGE")
    def test_final_integration_failure_routes_back_to_owner(self):
        self.env["FAKE_CODEX_SCENARIO"] = "final_repair"
        self.manifest["checks"].append({"id": "FINAL", "argv": [sys.executable, "-c", "from pathlib import Path; assert Path('integration.txt').read_text() == 'ready\\n'"], "cwd": ".", "timeout_seconds": 5})
        self.manifest["final_checks"].append("FINAL")
        self.write_manifest()
        digest = self.ready()
        self.assertIn("COMPLETED", self.call("--approve", digest).stdout)
        self.assertTrue((self.repo / "integration.txt").exists())
        self.assertEqual(self.state()["final_report"]["verdict"], "ACCEPTED")
    def test_lying_final_acceptance_cannot_bypass_failed_command(self):
        self.env["FAKE_CODEX_SCENARIO"] = "lying_final"
        self.manifest["checks"].append({"id": "FAIL", "argv": [sys.executable, "-c", "raise SystemExit(1)"], "cwd": ".", "timeout_seconds": 5})
        self.manifest["final_checks"].append("FAIL")
        self.write_manifest()
        digest = self.ready()
        p = self.call("--approve", digest, success=False)
        self.assertNotIn("Status: COMPLETED", p.stdout)
        self.assertEqual(self.state()["phase"], "Final")
        self.assertIsNone(self.state()["final_report"])
    def test_readiness_never_runs_host_commands_without_snapshot_authorization(self):
        self.call("--check", success=False)
        self.assertFalse(self.fake_state.exists())
        self.assertIsNone(self.state()["checks_authorized"])
        self.assertIsNone(self.state()["approved"])
    def test_wrong_approval_digest_does_not_start_building(self):
        self.ready()
        self.call("--approve", "wrong", success=False)
        self.assertEqual(json.loads(self.fake_state.read_text())["builds"], 0)
    def test_status_has_no_agent_side_effects(self):
        self.ready()
        before = self.fake_state.read_bytes()
        self.call("--status")
        self.assertEqual(before, self.fake_state.read_bytes())
    def test_dirty_user_work_is_preserved(self):
        digest = self.ready()
        (self.repo / "unrelated.txt").write_text("user work")
        self.call("--approve", digest, success=False)
        self.assertEqual((self.repo / "unrelated.txt").read_text(), "user work")
    def test_all_original_commands_still_have_help(self):
        for cmd in ["init", "sync", "config", "review", "run", "find", "reconcile", "log", "list", "add", "remove", "edit", "validate", "info", "workflow", "root", "exec", "radio", "agent", "stats"]:
            p = subprocess.run([str(BINARY), cmd, "--help"], cwd=self.repo, env=self.env, capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, (cmd, p.stderr))
        for cmd in ["plan", "p", "project", "pr", "build", "b", "review", "r", "resume", "stats", "transcript", "t", "config"]:
            p = subprocess.run([str(BINARY), "a", cmd, "--help"], cwd=self.repo, env=self.env, capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, (cmd, p.stderr))

if __name__ == "__main__":
    unittest.main()
