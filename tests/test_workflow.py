"""Behavior tests for the native hook gate; Python standard library and real Git only."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "workflow_gate.py"
spec = importlib.util.spec_from_file_location("gate", SCRIPT)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class Workflow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.project = self.root / "plans" / "sample"
        self.project.mkdir(parents=True)
        self.rel = "plans/sample"
        self.env = patch.dict(os.environ, {"DEV_WORKFLOW_RUN": "run1", "DEV_WORKFLOW_PHASE": "plan"})
        self.env.start()
        os.environ.pop("DEV_WORKFLOW_PROJECT", None)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "Test")
        (self.root / ".gitignore").write_text("plans/\n")
        (self.root / "main.txt").write_text("base\n")
        self.commit()
        self.write_package()
        self.calls = 0

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def git(self, *args):
        return w.git(self.root, *args)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "test: source")
        return self.git("rev-parse", "HEAD")

    def write_package(self, two=False):
        (self.project / "spec.md").write_text("# Contract\n## Acceptance\n- [O1] First outcome.\n" +
            ("- [O2] Second outcome.\n" if two else "") + "## Final checks\n- `cargo test --locked`\n")
        (self.project / "01-first.md").write_text("# First\n## Outcome\nFirst.\n## Acceptance\n- [O1] Verify first.\n## Dependencies\nNone\n")
        if two:
            (self.project / "02-second.md").write_text("# Second\n## Outcome\nSecond.\n## Acceptance\n- [O2] Verify second.\n## Dependencies\n- `plans/sample/01-first.md` — first output\n")

    def gate(self):
        return w.Gate(self.root, self.project)

    def event(self, kind, **kw):
        e = {"hook_event_name": kind, "cwd": str(self.root), "session_id": "root", "turn_id": "turn", **kw}
        return w.handle(self.root, e)

    def start(self, mode, name=None, worker=None):
        self.calls += 1
        role = "builder" if mode == "BUILD" else "planner" if mode == "MAINTAIN" else "reviewer"
        target = f"{self.rel}/{name}" if name else self.rel
        message = f"Use $dev-build.\nPlan: {target}\nMode: {mode}\n"
        if mode not in {"BUILD", "MAINTAIN", "READINESS", "MAINTENANCE"}:
            message += f"Revision: {self.gate().head()}\n"
        args = {"message": message}
        if worker:
            args["target"] = worker
            tool = "followup_task"
        else:
            args.update(agent_type=role, task_name=f"task_{self.calls}", fork_turns="none")
            tool = "spawn_agent"
        call = f"call{self.calls}"
        response = self.event("PreToolUse", tool_name=tool, tool_use_id=call, tool_input=args)
        header = w.headers(response["hookSpecificOutput"]["updatedInput"]["message"])
        if not worker:
            worker = f"worker-{self.calls}"
            self.event("SubagentStart", agent_id=worker, agent_type=role)
            self.event("PostToolUse", tool_name=tool, tool_use_id=call, tool_input=args,
                       tool_response={"task_name": f"/root/task_{self.calls}"})
        return self.gate().state["attempts"][header["Attempt"]], worker

    def report(self, job, verdict="ACCEPTED", findings=None, resolved=None):
        findings, resolved = findings or [], resolved or []
        mode = job["mode"]
        text = f"# Handoff\nPlan: {job['target']}\nMode: {mode}\nAttempt: {job['attempt']}\nSnapshot: {job['snapshot']}\n"
        if mode in {"BUILD", "MAINTAIN"}:
            text += f"Base revision: {job['start']}\nCommit: {'none' if job['start'] == self.gate().head() else self.gate().head()}\nStatus: {verdict}\n"
        else:
            text += f"Revision: {job['start']}\nVerdict: {verdict}\n"
        text += "\n## Acceptance\nO1 O2: verified against the required outcomes.\n\n## Verification\n"
        if mode == "FINAL":
            text += "| Check | Revision | Result | Evidence |\n|---|---|---|---|\n"
            text += f"| cargo test --locked | {self.gate().head()} | PASS | tests passed, log inspected |\n"
        else:
            text += "- Focused verification — PASS, expected behavior observed.\n"
        if findings:
            names = ["ID", "Kind", "Requirement", "Evidence", "Impact", "Required outcome"]
            if mode == "FINAL":
                names.append("Owner")
            text += "\n## Blocking findings\n| " + " | ".join(names) + " |\n|" + "---|" * len(names) + "\n"
            for fid in findings:
                text += f"| {fid} | CORRECTNESS | O1 | main.txt:1 reachable failure | outcome fails | check passes |"
                if mode == "FINAL":
                    text += f" {self.rel}/01-first.md |"
                text += "\n"
        if resolved:
            text += "\n## Resolutions\n| ID | State | Evidence |\n|---|---|---|\n"
            for fid in resolved:
                text += f"| {fid} | REFUTED | discriminating check disproves premise |\n"
        if verdict in {"BLOCKED", "REQUIRES REPLANNING"}:
            text += "\n## Reason\nConcrete unavailable prerequisite; attempted allowed remedies.\n## Next action\nProvide prerequisite.\n"
        path = self.root / job["artifact"]
        path.write_text(text)
        return path

    def stop(self, job, worker, verdict="ACCEPTED", findings=None, resolved=None):
        self.report(job, verdict, findings, resolved)
        self.event("SubagentStop", agent_id=worker, agent_type=job["role"], last_assistant_message="Handoff written.")

    def ready(self, two=False):
        if two:
            self.write_package(two=True)
        job, worker = self.start("READINESS")
        self.stop(job, worker)
        self.gate().approve()
        os.environ["DEV_WORKFLOW_PHASE"] = "project"
        self.event("SessionStart", source="startup")

    def accept_plan(self, name="01-first.md"):
        b, bw = self.start("BUILD", name)
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", name)
        self.stop(r, rw)
        return bw, rw

    def test_requires_independent_readiness(self):
        with self.assertRaisesRegex(w.Invalid, "READINESS"):
            self.gate().approve()

    def test_readiness_snapshot_invalidated_by_edit(self):
        job, worker = self.start("READINESS")
        self.stop(job, worker)
        with (self.project / "01-first.md").open("a") as f:
            f.write("Changed guidance.\n")
        with self.assertRaises(w.Invalid):
            self.gate().approve()

    def test_planning_cannot_fall_through_to_build(self):
        with self.assertRaises(w.Invalid):
            self.start("BUILD", "01-first.md")

    def test_dependency_order(self):
        self.ready(two=True)
        with self.assertRaisesRegex(w.Invalid, "dependencies"):
            self.start("BUILD", "02-second.md")
        self.accept_plan()
        job, _ = self.start("BUILD", "02-second.md")
        self.assertEqual(job["base"], self.gate().head())

    def test_cycle_rejected(self):
        self.write_package(two=True)
        path = self.project / "01-first.md"
        path.write_text(path.read_text().replace("None", "- `plans/sample/02-second.md` — output"))
        with self.assertRaisesRegex(w.Invalid, "Cyclic"):
            self.start("READINESS")

    def test_missing_obligation_rejected(self):
        (self.project / "01-first.md").write_text("## Acceptance\n- [O2] wrong\n## Dependencies\nNone\n")
        with self.assertRaises(w.Invalid):
            self.start("READINESS")

    def test_no_duplicate_live_assignment(self):
        self.ready()
        self.start("BUILD", "01-first.md")
        with self.assertRaisesRegex(w.Invalid, "live"):
            self.start("BUILD", "01-first.md")

    def test_wait_timeout_does_not_clear_active(self):
        self.ready()
        job, _ = self.start("BUILD", "01-first.md")
        self.event("PostToolUse", tool_name="wait_agent", tool_use_id="wait", tool_response={"timed_out": True})
        self.assertEqual(self.gate().state["active"], job["attempt"])

    def test_stale_same_revision_handoff_rejected(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", "01-first.md")
        self.stop(r, rw, "CHANGES REQUIRED", ["R1"])
        b2, _ = self.start("BUILD", "01-first.md", bw)
        self.stop(b2, bw, "NO CHANGE")
        r2, _ = self.start("REPAIR", "01-first.md", rw)
        with self.assertRaisesRegex(w.Invalid, "Attempt"):
            self.event("SubagentStop", agent_id=rw, agent_type="reviewer")
        self.assertEqual(r2["start"], r["start"])

    def test_evidence_only_repair_and_persistent_workers(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", "01-first.md")
        self.stop(r, rw, "CHANGES REQUIRED", ["R1"])
        b2, _ = self.start("BUILD", "01-first.md", bw)
        self.stop(b2, bw, "NO CHANGE")
        r2, _ = self.start("REPAIR", "01-first.md", rw)
        self.stop(r2, rw, resolved=["R1"])
        self.assertTrue(self.gate().accepted("01-first.md"))
        self.assertEqual(r["start"], r2["start"])

    def test_more_than_two_repairs_can_finish(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", "01-first.md")
        self.stop(r, rw, "CHANGES REQUIRED", ["R1"])
        for _ in range(5):
            b, _ = self.start("BUILD", "01-first.md", bw)
            self.stop(b, bw, "NO CHANGE")
            r, _ = self.start("REPAIR", "01-first.md", rw)
            self.stop(r, rw, "CHANGES REQUIRED", ["R1"])
        b, _ = self.start("BUILD", "01-first.md", bw)
        self.stop(b, bw, "NO CHANGE")
        r, _ = self.start("REPAIR", "01-first.md", rw)
        self.stop(r, rw, resolved=["R1"])
        self.assertTrue(self.gate().accepted("01-first.md"))

    def test_cannot_silently_drop_finding(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", "01-first.md")
        self.stop(r, rw, "CHANGES REQUIRED", ["R1"])
        b, _ = self.start("BUILD", "01-first.md", bw)
        self.stop(b, bw, "NO CHANGE")
        r, _ = self.start("REPAIR", "01-first.md", rw)
        with self.assertRaisesRegex(w.Invalid, "silently drop"):
            self.stop(r, rw)

    def rejected_candidate(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", "01-first.md")
        self.stop(r, rw, "CHANGES REQUIRED", ["R1"])
        return bw, rw

    def test_boundary_review_preserves_findings_through_recovery_to_completion(self):
        bw, rw = self.rejected_candidate()
        for verdict in ("BLOCKED", "REQUIRES REPLANNING"):
            b, _ = self.start("BUILD", "01-first.md", bw)
            self.stop(b, bw, "NO CHANGE")
            r, _ = self.start("REPAIR", "01-first.md", rw)
            self.stop(r, rw, verdict, ["R1"])
            state = self.gate().state
            self.assertNotIn("active", state)
            self.assertTrue(state["attempts"][r["attempt"]]["done"])
            self.assertEqual(state["reviews"]["01-first.md"]["verdict"], verdict)
            self.assertEqual([row["ID"] for row in state["reviews"]["01-first.md"]["findings"]], ["R1"])
            self.assertFalse(self.gate().accepted("01-first.md"))
            with self.assertRaisesRegex(w.Invalid, "independent ADJUDICATE"):
                self.event("Stop", last_assistant_message=f"Status: {verdict}")
        b, _ = self.start("BUILD", "01-first.md", bw)
        self.stop(b, bw, "NO CHANGE")
        r, _ = self.start("REPAIR", "01-first.md", rw)
        self.stop(r, rw, resolved=["R1"])
        self.assertTrue(self.gate().accepted("01-first.md"))
        final, fw = self.start("FINAL")
        self.stop(final, fw)
        self.event("Stop", last_assistant_message="Status: COMPLETED")
        self.assertEqual(self.gate().state["last_stop"]["status"], "COMPLETED")

    def test_boundary_review_cannot_silently_drop_prior_findings(self):
        _, rw = self.rejected_candidate()
        r, _ = self.start("REPAIR", "01-first.md", rw)
        for verdict in ("BLOCKED", "REQUIRES REPLANNING"):
            with self.assertRaisesRegex(w.Invalid, "silently drop"):
                self.stop(r, rw, verdict)
            self.assertEqual(self.gate().state["active"], r["attempt"])

    def test_boundary_review_with_open_findings_requires_reason_and_next_action(self):
        _, rw = self.rejected_candidate()
        r, _ = self.start("REPAIR", "01-first.md", rw)
        for verdict in ("BLOCKED", "REQUIRES REPLANNING"):
            for missing in ("Reason", "Next action"):
                path = self.report(r, verdict, ["R1"])
                path.write_text(path.read_text().replace(f"## {missing}\n", "## Omitted\n"))
                with self.assertRaisesRegex(w.Invalid, "Boundary claims"):
                    self.event("SubagentStop", agent_id=rw, agent_type="reviewer")
                self.assertEqual(self.gate().state["active"], r["attempt"])
        # Correcting fields completes the same assignment without another build/review.
        self.stop(r, rw, "BLOCKED", ["R1"])
        self.assertNotIn("active", self.gate().state)

    def test_boundary_adjudication_retains_findings_and_validates_terminal_stop(self):
        _, rw = self.rejected_candidate()
        aw = None
        for verdict in ("BLOCKED", "REQUIRES REPLANNING"):
            r, aw = self.start("ADJUDICATE", "01-first.md", aw)
            self.assertNotEqual(rw, aw)
            self.assertEqual([row["ID"] for row in r["previous"]], ["R1"])
            self.stop(r, aw, verdict, ["R1"])
            self.assertEqual(self.gate().state["boundary"]["verdict"], verdict)
            self.event("Stop", last_assistant_message=f"Status: {verdict}")
            self.assertEqual(self.gate().state["last_stop"]["status"], verdict)
            self.assertFalse(self.gate().accepted("01-first.md"))
            with self.assertRaises(w.Invalid):
                self.gate().complete()

    def test_readiness_boundary_retains_findings_without_approving_package(self):
        r, rw = self.start("READINESS")
        self.stop(r, rw, "CHANGES REQUIRED", ["P1"])
        for verdict in ("BLOCKED", "REQUIRES REPLANNING"):
            r, _ = self.start("READINESS", worker=rw)
            self.stop(r, rw, verdict, ["P1"])
            self.assertEqual([row["ID"] for row in self.gate().state["readiness"]["findings"]], ["P1"])
            with self.assertRaises(w.Invalid):
                self.gate().approve()
            with self.assertRaisesRegex(w.Invalid, "readiness acceptance"):
                self.event("Stop", last_assistant_message="Status: READY")
        r, _ = self.start("READINESS", worker=rw)
        self.stop(r, rw, resolved=["P1"])
        self.gate().approve()

    def test_final_boundary_preserves_findings_and_reopens_only_the_owner(self):
        self.ready(two=True)
        self.accept_plan()
        self.accept_plan("02-second.md")
        f, fw = self.start("FINAL")
        for verdict in ("CHANGES REQUIRED", "BLOCKED", "REQUIRES REPLANNING"):
            self.stop(f, fw, verdict, ["F1"])
            self.assertFalse(self.gate().accepted("01-first.md"))
            self.assertTrue(self.gate().accepted("02-second.md"))
            with self.assertRaises(w.Invalid):
                self.gate().complete()
            b, bw = self.start("BUILD", "01-first.md")
            self.stop(b, bw, "NO CHANGE")
            r, rw = self.start("REPAIR", "01-first.md")
            self.stop(r, rw, resolved=["F1"])
            f, _ = self.start("FINAL", worker=fw)
            self.assertEqual([row["ID"] for row in f["previous"]], ["F1"])
        self.stop(f, fw, resolved=["F1"])
        self.gate().complete()

    def test_accepted_review_cannot_retain_open_findings(self):
        _, rw = self.rejected_candidate()
        r, _ = self.start("REPAIR", "01-first.md", rw)
        with self.assertRaisesRegex(w.Invalid, "ACCEPTED cannot retain OPEN findings"):
            self.stop(r, rw, findings=["R1"])
        self.assertEqual(self.gate().state["active"], r["attempt"])
        self.assertFalse(self.gate().accepted("01-first.md"))

    def test_changes_required_needs_at_least_one_open_finding(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", "01-first.md")
        with self.assertRaisesRegex(w.Invalid, "CHANGES REQUIRED needs"):
            self.stop(r, rw, "CHANGES REQUIRED")
        self.assertEqual(self.gate().state["active"], r["attempt"])

    def test_builder_cannot_review_itself(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        with self.assertRaises(w.Invalid):
            self.start("INITIAL", "01-first.md", bw)

    def test_no_reusing_workers_for_another_plan(self):
        self.ready(two=True)
        bw, _ = self.accept_plan()
        with self.assertRaisesRegex(w.Invalid, "across plans"):
            self.start("BUILD", "02-second.md", bw)

    def test_final_reviewer_must_be_fresh(self):
        self.ready()
        readiness = next(v["id"] for v in self.gate().state["workers"].values() if v["purpose"] == "READINESS")
        self.accept_plan()
        with self.assertRaisesRegex(w.Invalid, "fresh"):
            self.start("FINAL", worker=readiness)

    def test_final_acceptance_gates_completion(self):
        self.ready()
        self.accept_plan()
        with self.assertRaisesRegex(w.Invalid, "FINAL"):
            self.event("Stop", last_assistant_message=f"Project: {self.rel}\nStatus: COMPLETED")
        r, rw = self.start("FINAL")
        self.stop(r, rw)
        self.event("Stop", last_assistant_message=f"Project: {self.rel}\nStatus: COMPLETED")
        self.assertEqual(self.gate().state["last_stop"]["status"], "COMPLETED")

    def test_final_failure_repairs_only_owner(self):
        self.ready(two=True)
        self.accept_plan()
        self.accept_plan("02-second.md")
        r, rw = self.start("FINAL")
        self.stop(r, rw, "CHANGES REQUIRED", ["F1"])
        self.assertFalse(self.gate().accepted("01-first.md"))
        self.assertTrue(self.gate().accepted("02-second.md"))
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        rr, rrw = self.start("REPAIR", "01-first.md")
        self.stop(rr, rrw, resolved=["F1"])
        final, _ = self.start("FINAL", worker=rw)
        self.stop(final, rw, resolved=["F1"])
        self.gate().complete()

    def test_final_checks_require_exact_revision_and_pass(self):
        self.ready()
        self.accept_plan()
        r, rw = self.start("FINAL")
        path = self.report(r)
        path.write_text(path.read_text().replace("| PASS |", "| NOT PASS |"))
        with self.assertRaisesRegex(w.Invalid, "PASS"):
            self.event("SubagentStop", agent_id=rw, agent_type="reviewer")

    def test_new_commit_invalidates_final(self):
        self.ready()
        self.accept_plan()
        r, rw = self.start("FINAL")
        self.stop(r, rw)
        (self.root / "main.txt").write_text("external edit\n")
        self.commit()
        with self.assertRaisesRegex(w.Invalid, "stale"):
            self.gate().complete()

    def test_dirty_work_is_not_discarded(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        (self.root / "main.txt").write_text("uncommitted\n")
        with self.assertRaisesRegex(w.Invalid, "dirty"):
            self.stop(b, bw, "NO CHANGE")
        self.assertEqual((self.root / "main.txt").read_text(), "uncommitted\n")

    def test_review_wrong_revision_rejected(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", "01-first.md")
        path = self.report(r)
        path.write_text(path.read_text().replace("Revision: " + r["start"], "Revision: " + "0" * 40))
        with self.assertRaisesRegex(w.Invalid, "revision"):
            self.event("SubagentStop", agent_id=rw, agent_type="reviewer")

    def proposal(self):
        proposal = self.project / ".proposal"
        proposal.mkdir()
        for p in self.project.glob("*.md"):
            if p.name == "spec.md" or w.PLAN_NAME.fullmatch(p.name):
                shutil.copy2(p, proposal / p.name)
        self.write_mapping(proposal)
        path = proposal / "01-first.md"
        path.write_text(path.read_text().replace("First.", "First, using the existing helper."))
        return proposal

    def write_mapping(self, proposal, new_owner=None):
        _, _, docs = self.gate().package(proposal=True)
        _, owners = self.gate().graph(docs)
        text = "# Maintenance\n## Obligation mapping\n| ID | Owner | Evidence |\n|---|---|---|\n"
        for oid, name in owners.items():
            text += f"| {oid} | {self.rel}/{name} | same obligation and executable verification |\n"
        pending = self.gate().open_work()
        if pending:
            text += "## Finding mapping\n| Old plan | ID | Owner | Evidence |\n|---|---|---|---|\n"
            for (old, fid) in pending:
                text += f"| {old} | {fid} | {new_owner or old} | original review evidence retained |\n"
        (proposal / "maintenance.md").write_text(text)

    def test_unreviewed_plan_edit_blocks_transition(self):
        self.ready()
        path = self.project / "01-first.md"
        path.write_text(path.read_text().replace("First.", "First, with different guidance."))
        with self.assertRaisesRegex(w.Invalid, "not active"):
            self.start("BUILD", "01-first.md")

    def test_maintenance_review_before_activation(self):
        self.ready()
        proposal = self.proposal()
        job, worker = self.start("MAINTENANCE")
        self.stop(job, worker)
        shutil.copy2(proposal / "01-first.md", self.project / "01-first.md")
        b, _ = self.start("BUILD", "01-first.md")
        self.assertEqual(b["snapshot"], job["snapshot"])

    def test_maintenance_cannot_change_binding_contract(self):
        self.ready()
        p = self.proposal()
        (p / "spec.md").write_text((p / "spec.md").read_text() + "\nChanged ownership.\n")
        with self.assertRaisesRegex(w.Invalid, "binding"):
            self.start("MAINTENANCE")

    def test_maintenance_cannot_rewrite_accepted_plan(self):
        self.ready()
        self.accept_plan()
        self.proposal()
        with self.assertRaisesRegex(w.Invalid, "accepted plans"):
            self.start("MAINTENANCE")

    def test_terminal_boundary_requires_independent_evidence(self):
        self.ready()
        with self.assertRaisesRegex(w.Invalid, "independent"):
            self.event("Stop", last_assistant_message="Status: BLOCKED\nReason: two repairs elapsed")
        job, worker = self.start("ADJUDICATE")
        self.stop(job, worker, "BLOCKED")
        self.event("Stop", last_assistant_message="Status: BLOCKED\nReason: confirmed missing prerequisite")

    def test_runtime_pause_does_not_manufacture_acceptance(self):
        self.ready()
        self.event("Stop", last_assistant_message="Status: PAUSED\nReason: service unavailable\nNext action: resume when service returns")
        with self.assertRaises(w.Invalid):
            self.gate().complete()

    def test_interrupt_allows_evidence_preserving_replacement(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.event("PreToolUse", tool_name="interrupt_agent", tool_use_id="interrupt", tool_input={"target": bw})
        self.assertEqual(self.gate().state["active"], b["attempt"])
        self.event("PostToolUse", tool_name="interrupt_agent", tool_use_id="interrupt", tool_input={"target": bw}, tool_response={"previous_status": "running"})
        replacement, _ = self.start("BUILD", "01-first.md")
        self.assertEqual(replacement["base"], b["base"])
        self.assertTrue(self.gate().state["attempts"][b["attempt"]]["interrupted"])

    def test_alias_continuation(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        alias = next(k for k, v in self.gate().state["workers"].items() if k.startswith("/root/") and v["id"] == bw)
        b2, _ = self.start("BUILD", "01-first.md", alias)
        self.assertEqual(b2["worker"], bw)

    def test_symlink_and_path_escape_rejected(self):
        (self.root / "plans" / "link").symlink_to(self.project, target_is_directory=True)
        with self.assertRaises(w.Invalid):
            w.Gate(self.root, "plans/link")
        with self.assertRaises(w.Invalid):
            self.gate().inside(self.root / "plans" / "sample" / ".." / "x")

    def test_schema_failure_returns_native_block_json(self):
        self.ready()
        event = {"hook_event_name": "PreToolUse", "session_id": "root", "tool_name": "spawn_agent", "tool_use_id": "bad", "tool_input": {"agent_type": "builder", "message": "No assignment fields"}}
        result = subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(event), text=True,
                                capture_output=True, cwd=self.root, check=True)
        output = json.loads(result.stdout)
        self.assertEqual(output["decision"], "block")
        self.assertIn("Plan", output["reason"])

    def test_untrusted_or_missing_hooks_cannot_certify_exit(self):
        self.ready()
        result = subprocess.run([sys.executable, str(SCRIPT), "finish"], env={**os.environ, "DEV_WORKFLOW_RUN": "unobserved", "DEV_WORKFLOW_PROJECT": self.rel}, text=True, capture_output=True, cwd=self.root)
        self.assertEqual(result.returncode, 2)
        self.assertIn("did not run", result.stderr)

    def test_plain_non_workflow_session_is_untouched(self):
        result = subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps({"hook_event_name": "Stop", "session_id": "unrelated", "last_assistant_message": "hello"}), text=True, capture_output=True, cwd=self.root, check=True)
        self.assertEqual(json.loads(result.stdout), {})
        self.assertFalse((self.root / "plans" / ".workflow.lock").exists())

    def test_final_findings_cannot_disappear_after_repair(self):
        self.ready()
        self.accept_plan()
        r, rw = self.start("FINAL")
        self.stop(r, rw, "CHANGES REQUIRED", ["F1"])
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        rr, rrw = self.start("REPAIR", "01-first.md")
        self.stop(rr, rrw, resolved=["F1"])
        final, _ = self.start("FINAL", worker=rw)
        with self.assertRaisesRegex(w.Invalid, "silently drop"):
            self.stop(final, rw)
        self.stop(final, rw, resolved=["F1"])
        self.gate().complete()

    def test_maintenance_preserves_findings_across_plan_rename(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", "01-first.md")
        self.stop(r, rw, "CHANGES REQUIRED", ["R1"])
        proposal = self.proposal()
        (proposal / "01-first.md").rename(proposal / "01-renamed.md")
        self.write_mapping(proposal, new_owner=f"{self.rel}/01-renamed.md")
        m, mw = self.start("MAINTENANCE")
        self.stop(m, mw)
        (self.project / "01-first.md").unlink()
        shutil.copy2(proposal / "01-renamed.md", self.project / "01-renamed.md")
        b, bw = self.start("BUILD", "01-renamed.md")
        self.assertEqual([row["ID"] for row in b["previous"]], ["R1"])
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("REPAIR", "01-renamed.md")
        with self.assertRaisesRegex(w.Invalid, "silently drop"):
            self.stop(r, rw)
        self.stop(r, rw, resolved=["R1"])

    def test_maintenance_mapping_is_bound_to_review(self):
        self.ready()
        proposal = self.proposal()
        m, mw = self.start("MAINTENANCE")
        mapping = proposal / "maintenance.md"
        mapping.write_text(mapping.read_text() + "\nChanged rationale.\n")
        with self.assertRaisesRegex(w.Invalid, "mapping changed"):
            self.stop(m, mw)

    def test_maintenance_omitted_finding_rejected(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", "01-first.md")
        self.stop(r, rw, "CHANGES REQUIRED", ["R1"])
        proposal = self.proposal()
        p = proposal / "maintenance.md"
        p.write_text(p.read_text().split("## Finding mapping")[0])
        with self.assertRaisesRegex(w.Invalid, "every OPEN"):
            self.start("MAINTENANCE")

    def test_exact_legacy_acceptance_import(self):
        rev = self.gate().head()
        (self.project / "01-first.build.md").write_text(f"Plan: {self.rel}/01-first.md\nCommit: {rev}\nStatus: COMPLETED\n")
        (self.project / "01-first.review.md").write_text(f"Plan: {self.rel}/01-first.md\nRevision: {rev}\nVerdict: ACCEPTED\n")
        self.ready()
        self.assertTrue(self.gate().accepted("01-first.md"))
        with self.assertRaisesRegex(w.Invalid, "FINAL"):
            self.gate().complete()
        r, rw = self.start("FINAL")
        self.stop(r, rw)
        self.gate().complete()

    def test_real_commits_keep_original_plan_baseline(self):
        self.ready(two=True)
        initial = self.gate().head()
        b, bw = self.start("BUILD", "01-first.md")
        (self.root / "main.txt").write_text("first implementation\n")
        candidate = self.commit()
        self.stop(b, bw, "COMPLETED")
        r, rw = self.start("INITIAL", "01-first.md")
        self.stop(r, rw, "CHANGES REQUIRED", ["R1"])
        b, _ = self.start("BUILD", "01-first.md", worker=bw)
        self.assertEqual(b["base"], initial)
        self.assertEqual(b["start"], candidate)
        (self.root / "main.txt").write_text("corrected implementation\n")
        repaired = self.commit()
        self.stop(b, bw, "COMPLETED")
        r, _ = self.start("REPAIR", "01-first.md", worker=rw)
        self.stop(r, rw, resolved=["R1"])
        b, bw2 = self.start("BUILD", "02-second.md")
        self.assertEqual(b["base"], repaired)
        self.stop(b, bw2, "NO CHANGE")
        r, rw2 = self.start("INITIAL", "02-second.md")
        self.stop(r, rw2)
        f, fw = self.start("FINAL")
        self.stop(f, fw)
        self.event("Stop", last_assistant_message="Status: COMPLETED")
        self.gate().complete()

    def test_script_prepare_finish_native_hooks_observed(self):
        self.ready()
        env = dict(os.environ, DEV_WORKFLOW_PROJECT=self.rel)
        result = subprocess.run([sys.executable, str(SCRIPT), "prepare", self.rel],
                                cwd=self.root, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.accept_plan()
        f, fw = self.start("FINAL")
        self.stop(f, fw)
        self.event("Stop", last_assistant_message="Status: COMPLETED")
        result = subprocess.run([sys.executable, str(SCRIPT), "finish"], cwd=self.root,
                                env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Verified workflow completion", result.stdout)

    def test_reviewer_cannot_adjudicate_its_own_finding(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.stop(b, bw, "NO CHANGE")
        r, rw = self.start("INITIAL", "01-first.md")
        self.stop(r, rw, "CHANGES REQUIRED", ["R1"])
        with self.assertRaisesRegex(w.Invalid, "fresh independent"):
            self.start("ADJUDICATE", "01-first.md", worker=rw)

    def test_boundary_can_inspect_uncommitted_blocked_work(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        (self.root / "main.txt").write_text("partial work preserved\n")
        self.stop(b, bw, "BLOCKED")
        r, rw = self.start("ADJUDICATE", "01-first.md")
        self.stop(r, rw, "BLOCKED")
        self.event("Stop", last_assistant_message="Status: BLOCKED")
        self.assertEqual((self.root / "main.txt").read_text(), "partial work preserved\n")

    def test_adjudication_cannot_skip_a_valid_build(self):
        self.ready()
        r, rw = self.start("ADJUDICATE", "01-first.md")
        with self.assertRaisesRegex(w.Invalid, "validated current build"):
            self.stop(r, rw)

    def test_explicit_execution_scope_rejects_another_project(self):
        self.ready()
        other = self.root / "plans" / "other"
        other.mkdir()
        with patch.dict(os.environ, {"DEV_WORKFLOW_PROJECT": self.rel}):
            with self.assertRaisesRegex(w.Invalid, "different project"):
                self.event("PreToolUse", tool_name="spawn_agent", tool_use_id="cross-project",
                           tool_input={"agent_type": "reviewer", "message": "Plan: plans/other\nMode: READINESS"})

    def test_subagent_start_after_spawn_output_uses_uuid(self):
        self.ready()
        args = {"agent_type": "builder", "task_name": "late_start", "fork_turns": "none",
                "message": f"Plan: {self.rel}/01-first.md\nMode: BUILD"}
        self.event("PreToolUse", tool_name="spawn_agent", tool_use_id="late", tool_input=args)
        self.event("PostToolUse", tool_name="spawn_agent", tool_use_id="late", tool_input=args,
                   tool_response={"task_name": "/root/late_start"})
        self.event("SubagentStart", agent_id="exact-uuid", agent_type="builder")
        g = self.gate()
        job = g.state["attempts"][g.state["active"]]
        self.assertEqual(job["worker"], "exact-uuid")
        self.assertEqual(g.state["workers"]["/root/late_start"]["id"], "exact-uuid")
        self.stop(job, "exact-uuid", "NO CHANGE")

    def test_readiness_stale_repository_cannot_be_approved(self):
        r, rw = self.start("READINESS")
        self.stop(r, rw)
        (self.root / "main.txt").write_text("changed feasibility inputs\n")
        self.commit()
        with self.assertRaisesRegex(w.Invalid, "current repository"):
            self.gate().approve()

    def test_readiness_cannot_accept_dirty_source(self):
        r, rw = self.start("READINESS")
        (self.root / "main.txt").write_text("uncommitted feasibility input\n")
        with self.assertRaisesRegex(w.Invalid, "dirty"):
            self.stop(r, rw)

    def test_execution_cannot_stop_with_old_ready_record(self):
        self.ready()
        with self.assertRaisesRegex(w.Invalid, "Continue the project"):
            self.event("Stop", last_assistant_message="Status: READY")

    def test_replanning_session_can_grill_before_new_approval(self):
        self.ready()
        with patch.dict(os.environ, {"DEV_WORKFLOW_PHASE": "plan"}):
            self.event("SessionStart", source="startup")
            self.event("Stop", last_assistant_message="Which ownership boundary is required?")
        self.assertEqual(self.gate().state["last_stop"]["status"], None)

    def test_resume_restores_project_mode_without_profile_override(self):
        self.ready()
        os.environ.pop("DEV_WORKFLOW_PHASE", None)
        self.event("SessionStart", source="resume")
        with self.assertRaisesRegex(w.Invalid, "Continue the project"):
            self.event("Stop", last_assistant_message="One child is done.")

    def test_readiness_must_close_prior_findings(self):
        r, rw = self.start("READINESS")
        self.stop(r, rw, "CHANGES REQUIRED", ["P1"])
        r, _ = self.start("READINESS", worker=rw)
        with self.assertRaisesRegex(w.Invalid, "silently drop"):
            self.stop(r, rw)
        self.stop(r, rw, resolved=["P1"])
        self.gate().approve()

    def test_no_overlapping_projects_in_same_worktree(self):
        self.ready()
        self.start("BUILD", "01-first.md")
        other = self.root / "plans" / "other"
        other.mkdir()
        for name in ("spec.md", "01-first.md"):
            shutil.copy2(self.project / name, other / name)
        with self.assertRaisesRegex(w.Invalid, "Another project has live work"):
            self.event("PreToolUse", tool_name="spawn_agent", tool_use_id="other",
                       tool_input={"agent_type": "reviewer", "fork_turns": "none",
                                   "message": "Plan: plans/other\nMode: READINESS"})

    def test_maintenance_planner_hands_off_before_independent_review(self):
        self.ready()
        m, mw = self.start("MAINTAIN")
        self.proposal()
        self.stop(m, mw, "COMPLETED")
        r, rw = self.start("MAINTENANCE")
        self.stop(r, rw)

    def test_correcting_malformed_handoff_does_not_start_new_attempt(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        p = self.report(b, "NO CHANGE")
        p.write_text(p.read_text().replace("Snapshot:", "Wrong field:"))
        with self.assertRaisesRegex(w.Invalid, "Snapshot"):
            self.event("SubagentStop", agent_id=bw, agent_type="builder")
        self.assertEqual(self.gate().state["active"], b["attempt"])
        self.stop(b, bw, "NO CHANGE")
        self.assertEqual(self.gate().state["builds"]["01-first.md"]["attempt"], b["attempt"])

    def test_failed_or_unknown_interrupt_does_not_unlock_work(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.event("PreToolUse", tool_name="interrupt_agent", tool_use_id="interrupt", tool_input={"target": bw})
        for response in ("error: not authorized", {"error": "unavailable"}, {}):
            with self.assertRaisesRegex(w.Invalid, "not confirmed"):
                self.event("PostToolUse", tool_name="interrupt_agent", tool_use_id="interrupt",
                           tool_input={"target": bw}, tool_response=response)
            self.assertEqual(self.gate().state["active"], b["attempt"])

    def test_serialized_native_interruption_response_is_supported(self):
        self.ready()
        b, bw = self.start("BUILD", "01-first.md")
        self.event("PreToolUse", tool_name="interrupt_agent", tool_use_id="interrupt", tool_input={"target": bw})
        self.event("PostToolUse", tool_name="interrupt_agent", tool_use_id="interrupt", tool_input={"target": bw},
                   tool_response=json.dumps({"previous_status": "running"}))
        self.assertNotIn("active", self.gate().state)

    def test_absolute_plan_path_is_canonicalized(self):
        self.ready()
        response = self.event("PreToolUse", tool_name="spawn_agent", tool_use_id="absolute",
                tool_input={"agent_type": "builder", "fork_turns": "none",
                            "message": f"Plan: {self.project}/01-first.md\nMode: BUILD"})
        text = response["hookSpecificOutput"]["updatedInput"]["message"]
        self.assertIn(f"Plan: {self.rel}/01-first.md", text)


if __name__ == "__main__":
    unittest.main()
