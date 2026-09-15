#!/usr/bin/env python3
"""Validate workflow assets/source wiring; no live Codex or behavioral claims."""

from __future__ import annotations
import argparse
import ast
import json
from pathlib import Path
import re
import tomllib
import yaml

ROOT = Path(__file__).resolve().parents[1]
ROLE_SKILLS = {
    "specifier": "dev-spec",
    "planner": "dev-plan",
    "builder": "dev-build",
    "builder_strong": "dev-build",
    "reviewer": "dev-review",
    "reviewer_strong": "dev-review",
    "orchestrator": "dev-project",
    "explorer": None,
}
PUBLIC_SKILLS = {"dev-spec", "dev-plan", "dev-build", "dev-review", "dev-project"}
EXPECTED_MODELS = {
    "specifier": ("gpt-6-astra", "medium"),
    "planner": ("gpt-5.6-sol", "high"),
    "builder": ("gpt-5.6-sol", "medium"),
    "builder_strong": ("gpt-5.6-sol", "high"),
    "reviewer": ("gpt-5.6-sol", "high"),
    "reviewer_strong": ("gpt-6-astra", "low"),
    "orchestrator": ("gpt-5.6-terra", "medium"),
    "explorer": ("gpt-5.6-luna", "medium"),
}
checks: list[str] = []


def check(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)
    checks.append(label)


def reject_model_policy(table: dict) -> None:
    for key, value in table.items():
        check(
            key
            not in {
                "model",
                "model_reasoning_effort",
                "default_subagent_model",
                "default_subagent_reasoning_effort",
            },
            f"No duplicate overlay selection: {key}",
        )
        if isinstance(value, dict):
            reject_model_policy(value)


def rust_delimiters(source: str) -> None:
    i = 0
    stack = []
    pairs = {")": "(", "]": "[", "}": "{"}
    while i < len(source):
        if source.startswith("//", i):
            pos = source.find("\n", i)
            i = len(source) if pos < 0 else pos
            continue
        if source.startswith("/*", i):
            depth = 1
            i += 2
            while i < len(source) and depth:
                if source.startswith("/*", i):
                    depth += 1
                    i += 2
                elif source.startswith("*/", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            assert depth == 0, "Unclosed Rust comment"
            continue
        raw = re.match(r'(?:br|cr|r)(#*)"', source[i:])
        if raw:
            end = '"' + raw.group(1)
            pos = source.find(end, i + raw.end())
            assert pos >= 0, "Unclosed Rust raw string"
            i = pos + len(end)
            continue
        if source[i] == '"':
            i += 1
            while i < len(source):
                if source[i] == "\\":
                    i += 2
                elif source[i] == '"':
                    i += 1
                    break
                else:
                    i += 1
            else:
                raise AssertionError("Unclosed Rust string")
            continue
        char = re.match(
            r"'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\n])'", source[i:]
        )
        if char:
            i += char.end()
            continue
        ch = source[i]
        if ch in "([{":
            stack.append(ch)
        elif ch in ")]}":
            assert stack and stack.pop() == pairs[ch], (
                f"Unbalanced Rust delimiter at {i}"
            )
        i += 1
    assert not stack, "Unclosed Rust delimiters"


def validate(root: Path = ROOT) -> dict:
    checks.clear()
    config = tomllib.loads((root / "agent.toml").read_text())
    reject_model_policy(config["codex"])
    check(
        set(config["profiles"])
        == {"default", "spec", "plan", "build", "review", "project", "explore"},
        "Canonical command profiles exist",
    )
    check(
        config["codex"]["agents"]["max_concurrent_threads_per_session"] == 8,
        "Eight-thread bounded concurrency",
    )

    actual_skills = {
        p.name for p in (root / "dotfiles/.agents/skills").iterdir() if p.is_dir()
    }
    check(actual_skills == PUBLIC_SKILLS, "Exactly five public skills")
    selections = {}
    role_lines = {}
    skill_lines = {}
    for role, skill in ROLE_SKILLS.items():
        path = root / f"dotfiles/.codex/agents/{role}.toml"
        check(path.is_file(), f"{role}: role exists")
        source = path.read_text()
        data = tomllib.loads(source)
        role_lines[role] = len(source.splitlines())
        check(role_lines[role] < 100, f"{role}: concise role")
        check(data["name"] == role, f"{role}: identity")
        selections[role] = [data["model"], data["model_reasoning_effort"]]
        check(
            tuple(selections[role]) == EXPECTED_MODELS[role],
            f"{role}: tuned model policy",
        )
        check(
            data["default_permissions"]
            in ("dev-explorer", "dev-workspace", "dev-builder"),
            f"{role}: permission profile",
        )
        check(
            'fork_turns="none"' in data["developer_instructions"],
            f"{role}: fresh Explorer/workflow handoff policy",
        )
        if skill:
            check(
                f"${skill}" in data["developer_instructions"], f"{role}: skill binding"
            )
        else:
            check(
                "$dev-" not in data["developer_instructions"],
                f"{role}: Explorer is TOML-only, not public skill",
            )
    check(
        tomllib.loads((root / "dotfiles/.codex/agents/explorer.toml").read_text())[
            "agents"
        ]["enabled"]
        is False,
        "Explorer is leaf",
    )

    for skill in sorted(PUBLIC_SKILLS):
        path = root / f"dotfiles/.agents/skills/{skill}/SKILL.md"
        source = path.read_text()
        skill_lines[skill] = len(source.splitlines())
        check(skill_lines[skill] < 100, f"{skill}: concise skill")
        front = yaml.safe_load(source.split("---", 2)[1])
        check(front["name"] == skill and front["description"], f"{skill}: frontmatter")
        check("gpt-" not in source.lower(), f"{skill}: no concrete model policy")
        ui = yaml.safe_load((path.parent / "agents/openai.yaml").read_text())
        check(
            ui["policy"]["allow_implicit_invocation"] is False,
            f"{skill}: explicit activation",
        )

    prompts = root / "dotfiles/.agents/skills/dev-project/prompts"
    expected_prompts = {
        "explore-facts.md",
        "plan-project.md",
        "replan-project.md",
        "build-task.md",
        "fix-task.md",
        "task-spec-review.md",
        "task-quality-review.md",
        "scoped-spec-rereview.md",
        "scoped-quality-rereview.md",
        "final-review.md",
        "scoped-final-rereview.md",
        "progress-template.md",
    }
    check(
        {p.name for p in prompts.glob("*.md")} == expected_prompts,
        "Complete dispatch prompt set",
    )
    scripts = root / "dotfiles/.agents/skills/dev-project/scripts"
    check(
        {p.name for p in scripts.glob("*.py")}
        == {
            "package_task.py",
            "package_review.py",
            "validate_workflow.py",
            "prepare_workspace.py",
        },
        "Mechanical helper set",
    )
    for path in scripts.glob("*.py"):
        ast.parse(path.read_text())
        check(True, f"{path.name}: Python syntax")

    # Core policy regression checks; these are textual/mechanical, not behavior evals.
    project = (root / "dotfiles/.agents/skills/dev-project/SKILL.md").read_text()
    for needle, label in [
        ("Maximum three task repair rounds", "three repair rounds"),
        ("Two fresh task Reviewers run **in parallel**", "parallel dual review"),
        ("Never spawn Specifier", "human-run spec boundary"),
        ("delete only `work/`", "success-only scratch cleanup"),
    ]:
        check(needle in project, f"dev-project: {label}")
    build = (root / "dotfiles/.agents/skills/dev-build/SKILL.md").read_text()
    check(
        "**RED:**" in build and "**GREEN:**" in build and "**REFACTOR:**" in build,
        "Builder strict TDD",
    )
    review = (root / "dotfiles/.agents/skills/dev-review/SKILL.md").read_text()
    check(
        "**Minor:**" in review
        and "Never blocks and never enters a repair loop" in review,
        "Reviewer severity text present",
    )

    main = (root / "src/main.rs").read_text()
    check("mod agent_roles;" in main, "Role loader wired into Rust main")
    check(
        "agent_roles::registration_args(&dir)?" in main,
        "Role registrations passed to Codex",
    )
    check("Explorer is intentionally a" in main, "TOML-only Explorer prompt path wired")
    registry = (root / "src/agent_roles.rs").read_text()
    for role, skill in ROLE_SKILLS.items():
        token = (
            f'role_with_skill!("{role}", "{skill}")'
            if skill
            else f'role_only!("{role}")'
        )
        check(token in registry, f"{role}: embedded role registration")
    for prompt in expected_prompts:
        check(prompt in registry, f"Embedded support prompt: {prompt}")
    for helper in (
        "package_task.py",
        "package_review.py",
        "validate_workflow.py",
        "prepare_workspace.py",
    ):
        check(helper in registry, f"Embedded support helper: {helper}")

    for path in (root / "src").rglob("*.rs"):
        rust_delimiters(path.read_text())
        check(True, f"{path.relative_to(root)}: lexical delimiter check")
        for match in re.finditer(r'include_str!\("([^"]+)"\)', path.read_text()):
            check(
                (path.parent / match[1]).is_file(), f"Existing include path: {match[1]}"
            )
    for path in [*(root / "tests").glob("*.py"), *(root / "scripts").glob("*.py")]:
        ast.parse(path.read_text())
        check(True, f"{path.name}: Python syntax")

    cases = yaml.safe_load((root / "tests/workflow_pressure_cases.yaml").read_text())
    check(
        isinstance(cases, list) and len(cases) >= 12,
        "Pressure scenario catalog has broad coverage",
    )
    check(len({c["id"] for c in cases}) == len(cases), "Pressure scenario IDs unique")
    return {
        "status": "PASS",
        "assertions": len(checks),
        "role_physical_lines": role_lines,
        "skill_physical_lines": skill_lines,
        "model_selections": selections,
        "public_skills": sorted(PUBLIC_SKILLS),
        "pressure_cases": len(cases),
        "rust_compiled": False,
        "live_codex_executed": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    result = validate()
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
