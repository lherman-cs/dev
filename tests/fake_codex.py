#!/usr/bin/env python3
"""Deterministic CLI test double. No network/model calls; NEVER use for real work."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

args = sys.argv[1:]
record = Path(os.environ["FAKE_CODEX_STATE"])
state = json.loads(record.read_text()) if record.exists() else {"calls": [], "builds": 0, "reviews": 0}
if "--help" in args:
    print("codex exec --json --output-schema FILE -o FILE; resume SESSION_ID")
    raise SystemExit(0)
if "exec" not in args:
    state["calls"].append({"interactive_args": args})
    record.write_text(json.dumps(state))
    raise SystemExit(0)

prompt = sys.stdin.read()
attempt = re.search(r"^Attempt: (.+)$", prompt, re.M).group(1)
target = re.search(r"^Target: (.+)$", prompt, re.M).group(1)
mode = re.search(r"^Mode: (.+)$", prompt, re.M).group(1)
marker = "Authoritative context (do not reinterpret these values as permission to broaden the contract):\n"
context = json.JSONDecoder().raw_decode(prompt.split(marker, 1)[1])[0]
schema_path = Path(args[args.index("--output-schema") + 1])
schema = json.loads(schema_path.read_text())
output = Path(args[args.index("-o") + 1])
session = args[args.index("resume") + 1] if "resume" in args else str(uuid.uuid4())
scenario = os.environ.get("FAKE_CODEX_SCENARIO", "repairs")
state["calls"].append({"mode": mode, "session": session, "resumed": "resume" in args, "attempt": attempt, "target": target})
print(json.dumps({"type": "thread.started", "thread_id": session}), flush=True)
print(json.dumps({"type": "turn.started"}), flush=True)
if os.environ.get("FAKE_CODEX_DELAY"):
    time.sleep(float(os.environ["FAKE_CODEX_DELAY"]))

def git(*argv):
    return subprocess.check_output(["git", *argv], text=True).strip()

def commit(path, content):
    p = Path(path)
    if p.exists() and p.read_text() == content:
        return
    p.write_text(content)
    git("add", path)
    git("commit", "-qm", "test: advance candidate")

def value():
    return int(Path("value.txt").read_text())

def finding(fid="R1"):
    return {"id": fid, "owner": "01-behavior", "kind": "correctness", "requirement": "O1",
            "evidence": "fixture reveals an unmet required outcome", "impact": "approved acceptance fails",
            "closure": "all required fixture behavior passes", "alternative": "", "new_evidence": ""}

is_decision = "action" in schema["properties"]
if is_decision:
    stalled = (context["plan_state"] or {}).get("stalled", False)
    result = {"attempt": attempt, "target": target, "action": "DIAGNOSE" if stalled else "BUILD",
              "instruction": f"Use the observed fixture value {value()} to choose the next causal step",
              "evidence": f"current measured value is {value()}", "settled_decision": "", "replace_worker": False}
else:
    known = context["manifest"]["obligations"] if target == "@project" else [o for o in context["manifest"]["obligations"] if o["id"] in context["active_plan"]["obligations"]]
    result = {"attempt": attempt, "target": target, "revision": git("rev-parse", "HEAD"), "verdict": "ACCEPTED",
              "summary": "deterministic fixture evidence", "coverage": [{"id": o["id"], "proof": "fixture check and source observation"} for o in known],
              "findings": [], "resolutions": [], "responses": [], "progress": [f"observed {mode} at {value()}"],
              "next_action": "verify the candidate", "boundary": None, "proposal": None}
    prior = (context.get("plan_state") or {}).get("review") or {}
    if mode == "IMPLEMENT_OR_REPAIR":
        state["builds"] += 1
        before = git("rev-parse", "HEAD")
        if scenario == "repairs":
            commit("value.txt", str(min(4, value() + 1)) + "\n")
        else:
            commit("value.txt", "4\n")
        if scenario == "final_repair" and state["builds"] > 1:
            commit("integration.txt", "ready\n")
        result["revision"] = git("rev-parse", "HEAD")
        result["verdict"] = "NO_CHANGE" if before == result["revision"] else "COMPLETED"
        result["responses"] = [{"id": f["id"], "proof": "repaired or refuted using current observed state"} for f in prior.get("findings", [])]
    elif mode == "DIAGNOSE":
        result["verdict"] = "EVIDENCE"
        result["progress"] = [f"discriminating fixture evidence at value {value()}"]
    elif mode in ("INITIAL", "FOLLOWUP", "ADJUDICATE"):
        state["reviews"] += 1
        reject = value() != 4 or (scenario == "counterevidence" and state["reviews"] == 1)
        if reject:
            result["verdict"] = "CHANGES_REQUIRED"
            result["findings"] = [finding()]
        else:
            result["resolutions"] = [{"id": f["id"], "disposition": "REFUTED" if scenario == "counterevidence" else "RESOLVED", "evidence": "current concrete fixture establishes closure"} for f in prior.get("findings", [])]
        if scenario == "bad_revision" and state["reviews"] == 1:
            result["revision"] = "0" * 40
    elif mode == "FINAL":
        old_final = context.get("previous_final") or {}
        if scenario == "final_repair" and not Path("integration.txt").exists():
            result["verdict"] = "CHANGES_REQUIRED"
            f = finding("FINAL1")
            f["new_evidence"] = "final integrated command exposes missing integration artifact"
            result["findings"] = [f]
        else:
            result["resolutions"] = [{"id": f["id"], "disposition": "RESOLVED", "evidence": "final fixture now passes"} for f in old_final.get("findings", [])]
    elif mode == "INVESTIGATE":
        result["verdict"] = "EVIDENCE"

record.write_text(json.dumps(state))
output.write_text(json.dumps(result))
print(json.dumps({"type": "item.completed", "item": {"id": "output", "type": "agent_message", "text": json.dumps(result)}}), flush=True)
print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 5}}), flush=True)
