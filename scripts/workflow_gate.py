"""Native Codex workflow gates. No scheduler, external packages, or shell execution.

This file is embedded by dev; `dev agent _workflow-hook` is its hook entry point.
Markdown is the contract. .workflow.json records observed attempts/receipts only.
"""
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

VERSION = 1
MODES = {"BUILD", "INITIAL", "REPAIR", "READINESS", "MAINTAIN", "MAINTENANCE", "FINAL", "ADJUDICATE"}
REVIEW_MODES = MODES - {"BUILD", "MAINTAIN"}
VERDICTS = {"ACCEPTED", "CHANGES REQUIRED", "BLOCKED", "REQUIRES REPLANNING"}
PLAN_NAME = re.compile(r"\d{2,}-[^/]+(?<!\.build)(?<!\.review)\.md\Z")
DISPATCH = {"spawn_agent", "followup_task", "send_input"}
LIFECYCLE = DISPATCH | {"send_message", "close_agent", "interrupt_agent", "resume_agent"}


class Invalid(Exception):
    """A correctable workflow violation; return it to the agent, never accept it."""


def require(ok, message):
    if not ok:
        raise Invalid(message)


def git(root, *args):
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=15)
    require(result.returncode == 0, f"Git metadata unavailable: {' '.join(args)}: {result.stderr.strip()}")
    return result.stdout.strip()


def root_at(cwd):
    return Path(git(Path(cwd), "rev-parse", "--show-toplevel")).resolve()


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(value).hexdigest()


def headers(text):
    result = {}
    # Deliberately narrow: only unindented header lines before the first ## section.
    for line in text.splitlines():
        if line.startswith("## "):
            break
        match = re.fullmatch(r"([A-Za-z][A-Za-z ]*):\s*(.*?)\s*", line)
        if match:
            key, value = match.groups()
            require(key not in result, f"Duplicate header: {key}")
            result[key] = value
    return result


def tool_response(event):
    value = event.get("tool_response")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def section(text, title):
    match = re.search(r"^## " + re.escape(title) + r"\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return match.group(1).strip() if match else ""


def rows(text, title):
    lines = [line.strip() for line in section(text, title).splitlines() if line.strip().startswith("|")]
    if not lines:
        return []
    require(len(lines) >= 2, f"Malformed table: {title}")
    names = [c.strip() for c in lines[0].strip("|").split("|")]
    require(len(names) == len(set(names)), f"Duplicate columns: {title}")
    out = []
    for line in lines[2:]:
        cells = [c.strip() for c in line.strip("|").split("|")]
        require(len(cells) == len(names) and all(cells), f"Incomplete table row: {title}")
        out.append(dict(zip(names, cells)))
    return out


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    require(not path.is_symlink(), f"Refusing symlink state: {path}")
    fd, name = tempfile.mkstemp(prefix=".workflow-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextlib.contextmanager
def locked(root):
    path = root / "plans" / ".workflow.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


class Gate:
    def __init__(self, root, project):
        self.root = root.resolve()
        self.project = self.inside(project)
        require(self.project.parent == self.root / "plans", "Use one direct project directory under plans/.")
        require(self.project.is_dir(), f"Missing project: {self.project}")
        self.rel = self.project.relative_to(self.root).as_posix()
        self.path = self.project / ".workflow.json"
        require(not self.path.is_symlink(), "Workflow journal must not be a symlink.")
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {
            "version": VERSION, "root": str(self.root), "project": self.rel,
            "workers": {}, "attempts": {}, "accepted": {}, "bases": {}, "sessions": []}
        require(self.state.get("version") == VERSION and self.state.get("root") == str(self.root)
                and self.state.get("project") == self.rel, "Journal belongs to another worktree/version.")

    def inside(self, path):
        path = Path(path)
        path = path if path.is_absolute() else self.root / path
        # Reject all symlink components, even when their destination happens to be inside root.
        require(path.is_relative_to(self.root) and ".." not in path.parts, "Path escapes worktree.")
        current = self.root
        for part in path.relative_to(self.root).parts:
            current /= part
            require(not current.is_symlink(), f"Workflow paths cannot contain symlinks: {current}")
        return path

    def save(self):
        atomic(self.path, self.state)

    def head(self):
        return git(self.root, "rev-parse", "HEAD")

    def revision(self, value):
        require(bool(re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", value or "")), "A full exact Git revision is required.")
        require(git(self.root, "rev-parse", "--verify", value + "^{commit}") == value, "Revision is not a commit.")
        require(git(self.root, "merge-base", value, self.head()) == value, "Revision is not on current history; reconcile, do not reset.")
        return value

    def clean(self):
        # The ignored plans directory is workflow state, not production input.
        changed = git(self.root, "status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude)plans")
        require(not changed, "Source tree is dirty; preserve/reconcile it before certifying an exact revision.")

    def package(self, proposal=False):
        directory = self.project / ".proposal" if proposal else self.project
        require(directory.is_dir() and not directory.is_symlink(), "Missing proposal/project directory.")
        spec = self.inside(directory / "spec.md")
        require(spec.is_file(), "Missing spec.md; keep the binding contract explicit.")
        paths = sorted(p for p in directory.iterdir() if PLAN_NAME.fullmatch(p.name))
        require(paths, "No numbered plans.")
        docs = {"spec.md": spec.read_text()}
        for path in paths:
            self.inside(path)
            require(path.is_file(), f"Not a plan file: {path}")
            docs[path.name] = path.read_text()
        return digest(docs), digest(docs["spec.md"].encode()), docs

    def graph(self, docs):
        graph = {}
        declared = re.findall(r"^- \[(O\d+)\]", section(docs["spec.md"], "Acceptance"), re.M)
        require(len(declared) == len(set(declared)), "Duplicate binding obligation IDs.")
        obligations = set(declared)
        require(obligations, "spec.md Acceptance needs stable obligation IDs: - [O1] ...")
        owned = {}
        for name, text in docs.items():
            if name == "spec.md":
                continue
            deps_text = section(text, "Dependencies")
            require(deps_text, f"{name}: missing Dependencies section (use None when empty).")
            deps = []
            if deps_text.rstrip(".").strip() != "None":
                for line in deps_text.splitlines():
                    match = re.match(r"^- `([^`]+\.md)`(?:\s+.*)?$", line)
                    require(match is not None, f"{name}: use - `plans/project/NN-name.md` — consumed output for dependencies.")
                    path = self.inside(match.group(1))
                    require(path.parent == self.project and path.name in docs, f"{name}: missing/foreign dependency.")
                    deps.append(path.name)
            graph[name] = deps
            ids = re.findall(r"^- \[(O\d+)\]", section(text, "Acceptance"), re.M)
            require(ids and len(ids) == len(set(ids)), f"{name}: missing/duplicate acceptance IDs.")
            for oid in ids:
                require(oid in obligations and oid not in owned, f"{name}: unknown or multiply-owned obligation {oid}.")
                owned[oid] = name
        require(set(owned) == obligations, "Every binding obligation must retain exactly one owning plan.")
        visiting, done = set(), set()
        def visit(name):
            require(name not in visiting, "Cyclic plan dependencies; propose contract-preserving maintenance.")
            if name in done:
                return
            visiting.add(name)
            for dep in graph[name]:
                visit(dep)
            visiting.remove(name)
            done.add(name)
        for name in graph:
            visit(name)
        return graph, owned

    def receipt_current(self, receipt):
        if not receipt:
            return False
        path = self.inside(receipt["artifact"])
        if not path.is_file() or digest(path.read_bytes()) != receipt["hash"]:
            return False
        if receipt.get("mapping_hash"):
            mapping = self.inside(self.project / ".proposal" / "maintenance.md")
            return mapping.is_file() and digest(mapping.read_bytes()) == receipt["mapping_hash"]
        return True

    def accepted(self, name):
        record = self.state["accepted"].get(name)
        if not record:
            return False
        if record.get("legacy"):
            return all(self.inside(p).is_file() and digest(self.inside(p).read_bytes()) == h
                       for p, h in record["files"].items())
        return self.receipt_current(record)

    def approve(self):
        snapshot, spec, docs = self.package()
        self.graph(docs)
        ready = self.state.get("readiness")
        # Resume a previously approved package or independently accepted maintenance unchanged.
        approved = self.state.get("approved") == snapshot
        if not approved and self.state.get("approved"):
            try:
                approved = self.current_package()[0] == snapshot
            except Invalid:
                pass
        require(approved or (self.receipt_current(ready) and ready["snapshot"] == snapshot
                and ready["verdict"] == "ACCEPTED" and ready["revision"] == self.head()),
                "These exact plans and current repository revision need an independent READINESS acceptance before execution.")
        require(not self.state.get("active"), "An attempt is active; resume its coordinator or reconcile its recorded interruption.")
        # A separate explicit CLI project invocation authorizes this reviewed snapshot, not arbitrary later edits.
        old_spec, old_docs = self.state.get("approved_spec"), self.state.get("approved_docs", {})
        if old_spec and old_spec != spec:
            self.state["accepted"] = {}
        else:
            for name in list(self.state["accepted"]):
                if old_docs and old_docs.get(name) != docs.get(name):
                    del self.state["accepted"][name]
        for record in self.state["accepted"].values():
            self.revision(record["revision"])
        self.state.update(approved=snapshot, approved_spec=spec, approved_docs=docs)
        # Preserve unambiguous historical accepted evidence; readiness/final review still applies.
        for name in docs:
            if name == "spec.md" or name in self.state["accepted"] or old_docs:
                continue
            build, review = self.project / name.replace(".md", ".build.md"), self.project / name.replace(".md", ".review.md")
            if not build.is_file() or not review.is_file():
                continue
            b, r = headers(build.read_text()), headers(review.read_text())
            rev = b.get("Commit") if b.get("Commit") not in {None, "none", "None"} else b.get("Base revision")
            if b.get("Status") in {"COMPLETED", "NO CHANGE"} and r.get("Verdict") == "ACCEPTED" and r.get("Revision") == rev:
                self.revision(rev)
                require(b.get("Plan") == r.get("Plan") == f"{self.rel}/{name}", "Legacy handoffs disagree on exact plan identity.")
                self.state["accepted"][name] = {"legacy": True, "revision": rev, "files": {
                    str(p.relative_to(self.root)): digest(p.read_bytes()) for p in (build, review)}}
        self.save()

    def open_work(self):
        pending = {}
        for name, review in self.state.get("reviews", {}).items():
            target = f"{self.rel}/{name}"
            for row in review.get("findings", []):
                if not row.get("Owner") or row["Owner"] == target:
                    pending[(target, row["ID"])] = row
        return pending

    def maintenance_mapping(self, docs):
        path = self.inside(self.project / ".proposal" / "maintenance.md")
        require(path.is_file(), "Proposal needs maintenance.md with obligation/finding mappings.")
        text = path.read_text()
        _, owners = self.graph(docs)
        obligations = rows(text, "Obligation mapping")
        require(len(obligations) == len(owners) and {r.get("ID") for r in obligations} == set(owners),
                "Maintenance must map every binding obligation exactly once.")
        for row in obligations:
            require(row.get("Owner") == f"{self.rel}/{owners[row['ID']]}" and row.get("Evidence"),
                    "Maintenance obligation mapping disagrees with the proposed plans.")
        findings = rows(text, "Finding mapping")
        keys = [(r.get("Old plan"), r.get("ID")) for r in findings]
        require(len(keys) == len(set(keys)) and set(keys) == set(self.open_work()),
                "Maintenance must preserve and reassign every OPEN finding exactly once.")
        destinations = set()
        for row in findings:
            target = row.get("Owner")
            require(target in {f"{self.rel}/{n}" for n in docs if n != "spec.md"} and row.get("Evidence"),
                    "A carried finding needs an exact proposed owner and original evidence.")
            key = (target, row["ID"])
            require(key not in destinations, "Merged finding IDs collide; retain plan-qualified stable IDs.")
            destinations.add(key)
        return digest(path.read_bytes()), findings

    def current_package(self):
        snapshot, spec, docs = self.package()
        if snapshot != self.state.get("approved"):
            maintenance = self.state.get("maintenance")
            require(self.receipt_current(maintenance) and maintenance["verdict"] == "ACCEPTED"
                    and maintenance["snapshot"] == snapshot and self.state.get("approved_spec") == spec,
                    "Plan edits are not active: require independent MAINTENANCE review, or new explicit approval for a binding change.")
            for name in self.state["accepted"]:
                require(docs.get(name) == self.state["approved_docs"].get(name), "Maintenance cannot rewrite accepted plans.")
            self.graph(docs)
            pending = self.open_work()
            carried = {}
            for row in maintenance["mapping"]:
                old = row["Old plan"], row["ID"]
                require(old in pending, "Pending work changed after maintenance review; review the new mapping.")
                name = Path(row["Owner"]).name
                review = carried.setdefault(name, {"findings": [], "origins": []})
                review["findings"].append(dict(pending[old], Owner=row["Owner"]))
                old_review = self.state["reviews"][Path(row["Old plan"]).name]
                review["origins"].extend(old_review.get("origins", [old_review.get("artifact", "")]))
            require(len(pending) == len(maintenance["mapping"]), "Maintenance mapping is stale.")
            self.state["reviews"] = {n: r for n, r in self.state.get("reviews", {}).items() if n in self.state["accepted"]}
            self.state["reviews"].update(carried)
            self.state.update(approved=snapshot, approved_docs=docs)
            self.state.pop("final", None)
        return snapshot, spec, docs

    def start(self, event, args, worker=None):
        text = args.get("message", "")
        require(isinstance(text, str) and text, "Workflow dispatch requires a plain message with Plan and Mode headers.")
        h = headers(text)
        mode, target = h.get("Mode"), h.get("Plan")
        require(mode in MODES and target, "Dispatch requires explicit Plan: ... and Mode: ... headers.")
        target_path = self.inside(target)
        target = target_path.relative_to(self.root).as_posix()
        text = re.sub(r"^Plan:.*$", "Plan: " + target, text, count=1, flags=re.M)
        require(target_path == self.project or (target_path.parent == self.project and PLAN_NAME.fullmatch(target_path.name)), "Invalid workflow target.")
        plan_mode = mode in {"BUILD", "INITIAL", "REPAIR"} or (mode == "ADJUDICATE" and target_path != self.project)
        require((target_path != self.project) == plan_mode, "Mode and plan/project target disagree.")
        role = "builder" if mode == "BUILD" else "planner" if mode == "MAINTAIN" else "reviewer"
        require((worker or {}).get("role", args.get("agent_type")) == role, f"{mode} requires independent {role} role.")
        require(not self.state.get("active"), "Another build/review attempt is live. Wait or interrupt it before reassignment.")
        for journal in (self.root / "plans").glob("*/.workflow.json"):
            if journal != self.path:
                other = Gate(self.root, journal.parent)
                require(not other.state.get("active"), f"Another project has live work in this worktree: {other.rel}")
        if not worker:
            require(args.get("fork_turns") == "none" or args.get("fork_context") is False, "Start plan workers without inherited conversation.")
        if worker:
            require(worker["target"] == target and worker["role"] == role, "Do not reuse a worker across plans/roles.")
            if mode in {"ADJUDICATE", "MAINTENANCE"}:
                require(worker.get("purpose") == mode, f"{mode} requires a fresh independent reviewer, then its own follow-ups.")
            require((worker.get("purpose") == "FINAL") == (mode == "FINAL"), "FINAL requires a fresh reviewer, then its own follow-ups.")
        snapshot, spec, docs = self.package(proposal=mode == "MAINTENANCE")
        graph, owners = self.graph(docs)
        if mode not in {"READINESS", "MAINTENANCE"}:
            current, _, _ = self.current_package()
            require(current == snapshot, "Candidate package mismatch.")
        if mode == "MAINTENANCE":
            require(spec == self.state.get("approved_spec"), "A binding spec change needs user approval, not maintenance.")
            for name in self.state["accepted"]:
                require(docs.get(name) == self.state["approved_docs"].get(name), "Keep accepted plans byte-identical during maintenance.")
            mapping_hash, mapping = self.maintenance_mapping(docs)
        head = self.head()
        if self.state.get("last_head") and mode not in {"READINESS", "MAINTENANCE"}:
            self.revision(self.state["last_head"])
        name = target_path.name
        if plan_mode:
            require(name in graph and all(self.accepted(d) for d in graph[name]), "Plan dependencies are not accepted.")
            if mode == "BUILD":
                ready = [n for n in graph if not self.accepted(n) and all(self.accepted(d) for d in graph[n])]
                require(ready and name == sorted(ready)[0], "Build the lowest-numbered dependency-ready incomplete plan.")
                require(not self.accepted(name), "Accepted work requires a concrete final finding before reopening.")
            self.state["bases"].setdefault(name, head)
        if mode in REVIEW_MODES and mode not in {"READINESS", "MAINTENANCE"}:
            if mode != "ADJUDICATE":
                self.clean()
            require(h.get("Revision") == head, "Review must target exact current HEAD; do not check out historical work to force it.")
        if mode in {"INITIAL", "REPAIR"}:
            build = self.state.get("builds", {}).get(name)
            require(self.receipt_current(build) and build["revision"] == head, "No current validated build handoff for this candidate.")
            require(not worker or worker.get("id") != build.get("worker"), "Builder cannot independently review its own work.")
        if mode == "INITIAL":
            require(name not in self.state.get("reviews", {}), "Initial review is already settled; use REPAIR or a targeted ADJUDICATE.")
        if mode == "FINAL":
            require(all(self.accepted(n) for n in graph), "All active plans must be accepted before FINAL review.")
        attempt = uuid.uuid4().hex
        artifact = (name.replace(".md", ".build.md" if mode == "BUILD" else ".review.md") if plan_mode
                    else {"READINESS": "readiness.review.md", "MAINTENANCE": "maintenance.review.md",
                          "MAINTAIN": "maintenance.build.md", "FINAL": "project.review.md",
                          "ADJUDICATE": "boundary.review.md"}[mode])
        previous = (self.state.get("reviews", {}).get(name) if plan_mode else
                    self.state.get({"FINAL": "final", "READINESS": "readiness", "MAINTENANCE": "maintenance",
                                    "ADJUDICATE": "adjudication"}.get(mode, "")))
        previous_findings = (previous or {}).get("findings", [])
        if plan_mode:
            previous_findings = [r for r in previous_findings if not r.get("Owner") or r["Owner"] == target]
        job = {"attempt": attempt, "mode": mode, "target": target, "role": role,
               "snapshot": snapshot, "start": head, "base": self.state["bases"].get(name, head),
               "artifact": f"{self.rel}/{artifact}", "call": event["tool_use_id"],
               "session": event["session_id"], "worker": (worker or {}).get("id"),
               "previous": previous_findings, "done": False}
        if mode == "MAINTENANCE":
            job.update(mapping_hash=mapping_hash, mapping=mapping)
        self.state["attempts"][attempt] = job
        self.state["active"] = attempt
        if event["session_id"] not in self.state["sessions"]:
            self.state["sessions"].append(event["session_id"])
        self.state.setdefault("session_modes", {}).setdefault(event["session_id"],
                os.environ.get("DEV_WORKFLOW_PHASE", "plan" if mode == "READINESS" else "project"))
        injected = (f"\n\nAttempt: {attempt}\nSnapshot: {snapshot}\nOriginal base: {job['base']}"
                    f"\nAssignment base: {head}\nHandoff: {job['artifact']}\n"
                    "Copy Attempt, Snapshot, Plan and Mode into the handoff header. Preserve the prior findings before replacing it.")
        if previous:
            paths = previous.get("origins", [previous.get("artifact", "")])
            injected += "\nPrior review evidence: " + ", ".join(sorted(set(p for p in paths if p)))
            injected += "\nOPEN finding IDs: " + ", ".join(r["ID"] for r in previous_findings)
        rewritten = dict(args, message=text + injected)
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": rewritten}}

    def attach(self, event):
        active = self.state.get("active")
        job = self.state["attempts"].get(active)
        if event.get("hook_event_name") == "PostToolUse":
            job = next((j for j in self.state["attempts"].values() if j["call"] == event.get("tool_use_id")), None)
        if not job:
            return
        if event.get("hook_event_name") == "SubagentStart":
            if event.get("agent_type") != job["role"]:
                return
            identity = event.get("agent_id")
        else:
            if job["call"] != event.get("tool_use_id"):
                return
            response = tool_response(event)
            if response.get("isError") or response.get("error"):
                job["interrupted"] = True
                self.state.pop("active", None)
                return
            identity = response.get("agent_id") or response.get("task_name")
        if identity:
            if job.get("worker"):
                info = self.state["workers"][job["worker"]]
                if event.get("hook_event_name") == "SubagentStart":
                    # SubagentStart carries the exact UUID even when spawn returned only an alias first.
                    for record in self.state["workers"].values():
                        if record["id"] == info["id"]:
                            record["id"] = identity
                    info["id"] = job["worker"] = identity
                self.state["workers"][identity] = info
            else:
                job["worker"] = identity
                self.state["workers"][identity] = {"id": identity, "role": job["role"], "target": job["target"], "purpose": job["mode"]}

    def finish_attempt(self, event):
        attempt = self.state.get("active")
        if not attempt:
            return
        job = self.state["attempts"][attempt]
        if event.get("agent_type") == "explorer":
            return
        worker = self.state["workers"].get(event.get("agent_id"))
        if worker and worker["id"] != job["worker"]:
            return
        require(worker and worker["id"] == job["worker"], "Unrecognized worker completion; do not use an unobserved handoff.")
        path = self.inside(job["artifact"])
        require(path.is_file(), f"Write {job['artifact']} before ending this attempt.")
        text = path.read_text()
        h = headers(text)
        for key, value in {"Attempt": attempt, "Snapshot": job["snapshot"], "Plan": job["target"], "Mode": job["mode"]}.items():
            require(h.get(key) == value, f"Handoff {key} does not identify the current assignment. Correct the header, not the engineering work.")
        snapshot, _, docs = self.package(proposal=job["mode"] == "MAINTENANCE")
        require(snapshot == job["snapshot"], "Reviewed plan snapshot changed during the attempt; review the new snapshot explicitly.")
        mode, name = job["mode"], Path(job["target"]).name
        if mode == "MAINTENANCE":
            mapping_hash, _ = self.maintenance_mapping(docs)
            require(mapping_hash == job["mapping_hash"], "Maintenance mapping changed during review.")
        revision = self.head()
        findings = []
        verdict = h.get("Status" if mode in {"BUILD", "MAINTAIN"} else "Verdict")
        if mode in {"BUILD", "MAINTAIN"}:
            require(verdict in {"COMPLETED", "NO CHANGE", "BLOCKED", "REQUIRES REPLANNING"}, "Unknown build status.")
            if mode == "BUILD" and verdict in {"COMPLETED", "NO CHANGE"}:
                self.clean()
                require(h.get("Base revision") == job["start"], "Build base must match this attempt's actual starting revision.")
                candidate = h.get("Commit") if h.get("Commit") not in {None, "none", "None"} else h.get("Base revision")
                require(candidate == revision, "Build result does not match HEAD.")
                self.revision(job["start"])
                require(section(text, "Verification"), "Build evidence needs focused verification outcomes.")
        else:
            require(verdict in VERDICTS, "Unknown review verdict.")
            if mode not in {"READINESS", "MAINTENANCE"}:
                if mode != "ADJUDICATE" or verdict == "ACCEPTED":
                    self.clean()
                require(h.get("Revision") == job["start"] == revision, "Review revision changed; inspect the actual candidate.")
            findings = rows(text, "Blocking findings")
            for row in findings:
                require(all(row.get(k) for k in ("ID", "Kind", "Requirement", "Evidence", "Impact", "Required outcome")), "Every blocker needs identity, kind, requirement, evidence, impact and closure condition.")
                require(row["Kind"] in {"CORRECTNESS", "DESIGN"}, "Finding Kind must be CORRECTNESS or DESIGN.")
                if row["Kind"] == "DESIGN":
                    require(mode in {"INITIAL", "READINESS", "MAINTENANCE", "ADJUDICATE"} or row.get("New evidence"), "Settled design requires new material evidence to reopen.")
                if mode == "FINAL":
                    require(row.get("Owner") in {f"{self.rel}/{n}" for n in docs if n != "spec.md"}, "FINAL blocker needs its exact owning plan.")
            require(len({r["ID"] for r in findings}) == len(findings), "Duplicate finding IDs.")
            # A boundary verdict pauses work; it does not resolve existing findings.
            require(verdict != "CHANGES REQUIRED" or findings, "CHANGES REQUIRED needs at least one OPEN finding.")
            require(verdict != "ACCEPTED" or not findings, "ACCEPTED cannot retain OPEN findings.")
            resolved = rows(text, "Resolutions")
            for row in resolved:
                require(row.get("State") in {"RESOLVED", "REFUTED"} and row.get("ID") and row.get("Evidence"), "Resolution needs ID, state and evidence.")
            open_ids, closed_ids = {r["ID"] for r in findings}, {r["ID"] for r in resolved}
            require(not (open_ids & closed_ids), "A finding cannot be both OPEN and closed.")
            require({r["ID"] for r in job["previous"]} <= open_ids | closed_ids, "Do not silently drop prior findings; retain, resolve or refute every ID.")
            if verdict == "ACCEPTED":
                if mode in {"READINESS", "MAINTENANCE"}:
                    self.clean()
                    require(revision == job["start"], "Repository revision changed during readiness review.")
                if mode == "ADJUDICATE" and name in docs:
                    build = self.state.get("builds", {}).get(name)
                    require(self.receipt_current(build) and build["revision"] == revision,
                            "Adjudication cannot accept implementation without a validated current build.")
                required = set(re.findall(r"^- \[(O\d+)\]", section(docs[name] if name in docs else docs["spec.md"], "Acceptance"), re.M))
                observed = set(re.findall(r"\bO\d+\b", section(text, "Acceptance")))
                require(required <= observed and section(text, "Verification"), "Acceptance must map every applicable obligation to verification evidence.")
                if mode == "FINAL":
                    commands = re.findall(r"^- `([^`]+)`", section(docs["spec.md"], "Final checks"), re.M)
                    verification = rows(text, "Verification")
                    require(commands and all(any(row.get("Check") == c and row.get("Revision") == revision and row.get("Result") == "PASS" and row.get("Evidence") for row in verification) for c in commands), "FINAL needs an exact-revision PASS row with evidence for every approved final check.")
            if verdict in {"BLOCKED", "REQUIRES REPLANNING"}:
                require(section(text, "Reason") and section(text, "Next action"), "Boundary claims need concrete evidence, attempted remedies, and a next action.")
        receipt = {"artifact": job["artifact"], "hash": digest(path.read_bytes()), "snapshot": snapshot,
                   "revision": revision, "verdict": verdict, "attempt": attempt, "worker": job["worker"], "findings": findings}
        if mode == "MAINTENANCE":
            receipt.update(mapping_hash=job["mapping_hash"], mapping=job["mapping"])
        job.update(done=True, receipt=receipt)
        self.state["last_head"] = revision
        self.state.pop("active", None)
        if mode == "BUILD":
            if verdict in {"COMPLETED", "NO CHANGE"}:
                self.state.setdefault("builds", {})[name] = receipt
            # Retain final findings for explicit closure in the next FINAL turn.
            # Its old verdict/revision cannot certify a different or rejected candidate.
        elif mode in {"INITIAL", "REPAIR", "ADJUDICATE"} and name in docs:
            self.state.setdefault("reviews", {})[name] = receipt
            for worker in self.state["workers"].values():
                if worker["id"] == job["worker"]:
                    worker["purpose"] = mode
            if verdict == "ACCEPTED":
                self.state["accepted"][name] = receipt
        elif mode == "READINESS":
            self.state["readiness"] = receipt
        elif mode == "MAINTENANCE":
            self.state["maintenance"] = receipt
        elif mode == "FINAL":
            self.state["final"] = receipt
            for row in findings:
                owner = Path(row["Owner"]).name
                self.state["accepted"].pop(owner, None)
                self.state.setdefault("reviews", {})[owner] = receipt
        if mode == "ADJUDICATE":
            self.state["adjudication"] = receipt
            if verdict in {"BLOCKED", "REQUIRES REPLANNING"}:
                self.state["boundary"] = receipt

    def complete(self):
        snapshot, _, docs = self.current_package()
        graph, _ = self.graph(docs)
        require(not self.state.get("active") and all(self.accepted(n) for n in graph), "Project still has incomplete plans or a live attempt.")
        final = self.state.get("final")
        require(self.receipt_current(final) and final["verdict"] == "ACCEPTED"
                and final["snapshot"] == snapshot and final["revision"] == self.head(), "Independent FINAL acceptance is missing/stale at current HEAD.")
        self.clean()


def select(root, event, args=None):
    args = args or {}
    h = headers(args.get("message", "")) if isinstance(args.get("message", ""), str) else {}
    if h.get("Plan"):
        path = Path(h["Plan"])
        project = path.parent if PLAN_NAME.fullmatch(path.name) else path
        gate = Gate(root, project)
        explicit = os.environ.get("DEV_WORKFLOW_PROJECT")
        if explicit:
            require(gate.project == Gate(root, explicit).project, "Dispatch belongs to a different project than this execution session.")
        return gate
    explicit = os.environ.get("DEV_WORKFLOW_PROJECT")
    if explicit:
        return Gate(root, explicit)
    target = args.get("target", args.get("id"))
    matches = []
    for path in (root / "plans").glob("*/.workflow.json"):
        gate = Gate(root, path.parent)
        if event.get("session_id") in gate.state["sessions"] or target in gate.state["workers"]:
            matches.append(gate)
    require(len(matches) <= 1, "Session belongs to multiple projects; resume with an explicit project path.")
    return matches[0] if matches else None


def handle(root, event):
    kind = event.get("hook_event_name")
    args = event.get("tool_input") or {}
    tool = re.split(r"[.:/]", event.get("tool_name", ""))[-1]
    gate = select(root, event, args if tool in LIFECYCLE else None)
    if not gate:
        return {}
    with locked(root):
        gate = Gate(root, gate.project)
        output = {}
        if kind in {"SessionStart", "UserPromptSubmit"}:
            sid = event["session_id"]
            if sid not in gate.state["sessions"]:
                gate.state["sessions"].append(sid)
            phase = os.environ.get("DEV_WORKFLOW_PHASE")
            if phase:
                gate.state.setdefault("session_modes", {})[sid] = phase
            gate.state["last_run"] = os.environ.get("DEV_WORKFLOW_RUN")
        elif kind == "PreToolUse" and tool in LIFECYCLE:
            target = args.get("target", args.get("id"))
            worker = gate.state["workers"].get(target)
            if tool in DISPATCH:
                role = (worker or {}).get("role", args.get("agent_type"))
                if role != "explorer":
                    if tool != "spawn_agent":
                        require(worker is not None, "Unknown worker target; use the observed exact identity or create a replacement.")
                    output = gate.start(event, args, worker)
            elif tool == "send_message" and worker:
                raise Invalid("send_message does not start a turn. Use the supported continuation tool with explicit Plan/Mode headers.")
            elif tool in {"close_agent", "interrupt_agent"} and worker:
                # Clear only on observed successful PostToolUse, not on a proposal to interrupt.
                gate.state["pending_interrupt"] = {"call": event["tool_use_id"], "worker": worker["id"]}
        elif kind == "PostToolUse":
            pending = gate.state.get("pending_interrupt")
            response = tool_response(event)
            if pending and pending["call"] == event.get("tool_use_id"):
                require("previous_status" in response and not response.get("error") and not response.get("isError"),
                        "Native interruption was not confirmed; preserve the active attempt and inspect the runtime result.")
                active = gate.state.get("active")
                if active and gate.state["attempts"][active].get("worker") == pending["worker"]:
                    gate.state["attempts"][active]["interrupted"] = True
                    gate.state.pop("active", None)
                gate.state.pop("pending_interrupt", None)
            else:
                gate.attach(event)
        elif kind == "SubagentStart":
            gate.attach(event)
        elif kind == "SubagentStop":
            gate.finish_attempt(event)
        elif kind == "Stop":
            h = headers(event.get("last_assistant_message") or "")
            status = h.get("Status")
            execution = gate.state.get("session_modes", {}).get(event["session_id"]) == "project"
            if status == "READY" and not execution:
                snapshot, _, _ = gate.package()
                r = gate.state.get("readiness")
                require(gate.receipt_current(r) and r["snapshot"] == snapshot and r["verdict"] == "ACCEPTED", "Do not claim READY before exact-snapshot independent readiness acceptance.")
            elif execution:
                if status == "COMPLETED":
                    gate.complete()
                elif status in {"BLOCKED", "REQUIRES REPLANNING"}:
                    r = gate.state.get("boundary")
                    require(gate.receipt_current(r) and r["verdict"] == status and r["revision"] == gate.head() and r["snapshot"] == gate.package()[0], "Technical stops need independent ADJUDICATE evidence, not a repair-round limit.")
                elif status == "PAUSED":
                    require(h.get("Reason") and h.get("Next action"), "PAUSED needs a runtime/user-budget reason and recoverable next action; it is not acceptance.")
                else:
                    raise Invalid("Continue the project: execute the next transition. Use COMPLETED only after FINAL acceptance; PAUSED only for runtime/user intervention with a next action.")
            gate.state["last_stop"] = {"run": os.environ.get("DEV_WORKFLOW_RUN"), "status": status}
        gate.save()
        return output


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        try:
            root = root_at(os.getcwd())
        except Invalid:
            if not argv and not os.environ.get("DEV_WORKFLOW_PROJECT"):
                print("{}")
                return 0
            raise
        if argv and argv[0] == "prepare":
            candidates = []
            for word in argv[1:]:
                path = Path(word)
                path = (Path.cwd() / path) if not path.is_absolute() else path
                if path.is_dir() and path.resolve().parent == root / "plans":
                    candidates.append(path.resolve())
            require(len(set(candidates)) == 1, "Pass one exact project directory under plans/ to enforced execution.")
            with locked(root):
                gate = Gate(root, candidates[0])
                gate.approve()
            print(gate.rel)
        elif argv and argv[0] == "finish":
            project = os.environ.get("DEV_WORKFLOW_PROJECT")
            gates = [Gate(root, project)] if project else [Gate(root, p.parent) for p in (root / "plans").glob("*/.workflow.json")]
            run = os.environ.get("DEV_WORKFLOW_RUN")
            matched = [g for g in gates if g.state.get("last_run") == run]
            require(matched, "Native workflow hooks did not run. Trust this dev hook in Codex /hooks and retry; this run has no validated completion.")
            for gate in matched:
                stop = gate.state.get("last_stop", {})
                require(stop.get("run") == run, "Session ended without a validated stop; state is preserved, project is not complete.")
                require(stop.get("status") in {"COMPLETED", "BLOCKED", "REQUIRES REPLANNING", "PAUSED"},
                        "Project execution did not end with a validated terminal or recoverable status.")
                if stop.get("status") == "COMPLETED":
                    gate.complete()
                    print(f"Verified workflow completion: {gate.rel} @ {gate.head()}")
        else:
            event = json.load(sys.stdin)
            try:
                print(json.dumps(handle(root, event)))
            except Exception as exc:
                # JSON block works for PreToolUse and Stop/SubagentStop. Do not fail open on bad input.
                print(json.dumps({"decision": "block", "reason": f"Workflow gate: {exc}"}))
        return 0
    except Exception as exc:
        print(f"Workflow gate: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
