#!/usr/bin/env python3
from pathlib import Path
import ast, json

ROOT = Path(__file__).resolve().parents[1]


def main():
    checks = []

    def check(condition, label):
        if not condition:
            raise AssertionError(label)
        checks.append(label)

    skills = ROOT / "dotfiles/.agents/skills"
    expected = {"dev-spec", "dev-plan", "dev-implement", "dev-prepare", "dev-review"}
    actual = {p.name for p in skills.iterdir() if p.is_dir()}
    check(actual == expected, f"exact workflow skills: {actual}")

    content = {name: (skills / name / "SKILL.md").read_text() for name in expected}
    for name, text in content.items():
        check(f"name: {name}" in text, f"{name} frontmatter")
        check(len(text.encode()) < 2000, f"{name} remains compact")
        check("DEV_WORKFLOW_SHIP" not in text, f"{name} has no runtime mode")
        check("Codex" not in text and "Lavish" not in text, f"{name} has no retired harness")

    check("Challenge ambiguity" in content["dev-spec"] and "open decisions" in content["dev-spec"], "spec semantics")
    check("Dispatched plans are immutable" in content["dev-plan"] and "supersedes" in content["dev-plan"], "plan replacement semantics")
    check("Conventional Commit" in content["dev-implement"] and "NEEDS_REPLAN" in content["dev-implement"], "implement contract")
    check("all approved plans/repairs complete" in content["dev-prepare"] and "mechanical/minimal" in content["dev-prepare"], "prepare boundary")
    check("Red CI is evidence" in content["dev-review"] and "PASS means no material issue found" in content["dev-review"], "review standard")

    root_agents = (ROOT / "AGENTS.md").read_text()
    global_agents = (ROOT / "dotfiles/.pi/agent/AGENTS.md").read_text()
    for invariant in ["No duplication or contradiction", "Least-privilege scope", "Do not teach defaults"]:
        check(invariant in root_agents, f"instruction invariant: {invariant}")
    check(len(global_agents.encode()) < 500, "global prompt contains only user-wide preferences")
    for generic in ["Fix root causes", "simplest durable design", "Tests must be", "quality, simplicity, robustness"]:
        check(generic not in global_agents, f"global prompt avoids generic guidance: {generic}")

    ext = ROOT / "dotfiles/.pi/agent/extensions/dev-workflow.ts"
    cfg = ROOT / "dotfiles/.pi/agent/dev-workflow.json"
    settings = ROOT / "dotfiles/.pi/agent/settings.json"
    check(ext.is_file() and cfg.is_file() and settings.is_file(), "Pi workflow assets present")

    ext_text = ext.read_text()
    for command in ["dev-spec", "dev-plan", "dev-build", "dev-prepare", "dev-review", "dev-ship"]:
        check(f'registerCommand("{command}"' in ext_text, f"Pi command /{command}")

    for required in [
        'name: "workflow_brief"',
        'name: "explore"',
        "handleMouse(event)",
        "new Image(",
        "new Markdown(",
        "resolvedRoleProfile",
        '"--mode", "json"',
        '"--no-session"',
        'readSkill("dev-implement")',
        'readSkill("dev-review")',
        "CONVENTIONAL_COMMIT_RE",
        "async function driveShip",
        "async function awaitShipSignals",
        "--force-with-lease",
        "fs.renameSync(temp, file)",
    ]:
        check(required in ext_text, f"extension capability: {required}")

    check("builderSystem" not in ext_text, "implementation semantics are not duplicated in controller")
    check("DEV_WORKFLOW_SHIP" not in ext_text, "no hidden ship mode")
    check("Plan-ID:" not in ext_text, "workflow IDs do not leak into commit contract")
    check("This is the manual review command." in ext_text and "Present one workflow_brief" in ext_text, "manual review UI is invocation-scoped")

    config = json.loads(cfg.read_text())
    expected_models = {"spec", "plan", "builder", "builder_retry", "explorer", "prepare", "review", "ship"}
    check(set(config["models"]) == expected_models, "role-specific model matrix")
    check(config["build"]["max_attempts_per_plan"] == 2, "bounded Implementer attempts")
    check(config["explorer"]["max_parallel"] >= 2, "parallel Explorer configured")
    check(config["ship"]["max_repair_rounds"] == 2, "bounded automatic repair rounds")
    check(config["ship"]["poll_seconds"] >= 5, "cheap GitHub polling cadence")

    pi_settings = json.loads(settings.read_text())
    check(pi_settings["tuiMode"] == "fullscreen", "fullscreen Pi TUI")
    check(pi_settings["terminal"]["showImages"] is True, "terminal images enabled")

    workflow = (ROOT / "WORKFLOW.md").read_text()
    readme = (ROOT / "README.md").read_text()
    check("No model tokens are consumed while waiting" in workflow, "await is traditional tooling only")
    check("ship.toon" in workflow and "progress.toon" in workflow, "minimal durable state documented")
    check("Conventional Commit" in workflow and "no workflow IDs" in workflow, "clean Git history documented")
    check("workflow_brief" in workflow and "Explorer" in readme, "review UX and Explorer documented")

    check(not (skills / "dev-project").exists(), "no orchestrator skill")
    check(not (skills / "dev-build").exists(), "build is controller, not skill")
    check(not (skills / "dev-ship").exists(), "ship is controller, not skill")
    check("/plans/" in (ROOT / ".gitignore").read_text(), "workflow artifacts ignored")

    for skill_md in skills.glob("dev-*/SKILL.md"):
        check("/dev-" not in skill_md.read_text(), f"{skill_md.parent.name} does not route workflow")

    install = (ROOT / "install.sh").read_text()
    check("@toon-format/cli" in install and "pi-coding-agent" in install, "Pi + TOON installed")
    check("lavish" not in install.lower(), "no Lavish dependency")

    for p in (ROOT / "tests").glob("*.py"):
        ast.parse(p.read_text())
        checks.append(f"python syntax {p.name}")

    print(json.dumps({"status": "PASS", "assertions": len(checks)}, indent=2))


if __name__ == "__main__":
    main()
