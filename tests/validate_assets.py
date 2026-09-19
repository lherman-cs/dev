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

    for name in sorted(expected):
        text = (skills / name / "SKILL.md").read_text()
        check(f"name: {name}" in text, f"{name} frontmatter")
        check(len(text.encode()) < 2000, f"{name} remains compact")
        check("DEV_WORKFLOW_SHIP" not in text, f"{name} has no hidden mode")
        check("lavish-axi" not in text, f"{name} does not own review UI mechanics")

    spec = (skills / "dev-spec/SKILL.md").read_text()
    plan = (skills / "dev-plan/SKILL.md").read_text()
    implement = (skills / "dev-implement/SKILL.md").read_text()
    prepare = (skills / "dev-prepare/SKILL.md").read_text()
    review = (skills / "dev-review/SKILL.md").read_text()

    check("Challenge ambiguity" in spec and "human decides" in spec, "spec preserves semantic challenge")
    check("Dispatched plans are immutable" in plan and "supersedes" in plan, "plan preserves immutable replacement semantics")
    check("Conventional Commit" in implement and "NEEDS_REPLAN" in implement, "implement owns commit/escalation semantics")
    check("all approved plans/repairs complete" in prepare and "mechanical/minimal" in prepare, "prepare stays mechanical")
    check("Red CI is evidence" in review and "PASS means no material issue found" in review, "review standard preserved")

    ext = ROOT / "dotfiles/.pi/agent/extensions/dev-workflow.ts"
    cfg = ROOT / "dotfiles/.pi/agent/dev-workflow.json"
    settings = ROOT / "dotfiles/.pi/agent/settings.json"
    guidelines = ROOT / "dotfiles/.pi/agent/AGENTS.md"
    check(ext.is_file(), "Pi extension present")
    check(cfg.is_file(), "model config present")
    check(settings.is_file(), "Pi settings present")
    check(guidelines.is_file(), "global preferences present")

    ext_text = ext.read_text()
    for command in ["dev-spec", "dev-plan", "dev-build", "dev-prepare", "dev-review", "dev-ship"]:
        check(f'registerCommand("{command}"' in ext_text, f"Pi command /{command}")

    check('name: "explore"' in ext_text, "Explorer tool")
    check("resolvedRoleProfile" in ext_text, "child agents resolve explicit role model")
    check('"--mode", "json"' in ext_text and '"--no-session"' in ext_text, "fresh streamed child sessions")
    check("CONVENTIONAL_COMMIT_RE" in ext_text and "Plan-ID:" not in ext_text, "conventional commits without workflow metadata")
    check('readSkill("dev-implement")' in ext_text and 'readSkill("dev-review")' in ext_text, "controllers reuse semantic skills")
    check("DEV_WORKFLOW_EXPLORER" in ext_text and "read-only" in ext_text, "Explorer read-only enforcement")
    check("async function driveShip" in ext_text and "async function awaitShipSignals" in ext_text, "deterministic shipping driver")
    check("DEV_WORKFLOW_SHIP" not in ext_text, "no hidden ship mode")
    check("fs.renameSync(temp, file)" in ext_text, "workflow TOON writes are atomic")

    check("lavishReviewInvocation" in ext_text and "runLavishFinalReview" in ext_text, "Lavish review integration")
    check("lavish-axi --help" in ext_text, "Lavish live guidance is authoritative")
    check("workflow_brief" not in ext_text and "RichBriefView" not in ext_text, "custom review UI removed")
    check("getMarkdownTheme" not in ext_text and "new Image(" not in ext_text, "custom rich renderer removed")

    config = json.loads(cfg.read_text())
    expected_models = {"spec", "plan", "builder", "builder_retry", "explorer", "prepare", "review", "ship"}
    check(set(config["models"]) == expected_models, "role-specific model matrix")
    check(config["build"]["max_attempts_per_plan"] == 2, "bounded Builder attempts")
    check(config["explorer"]["max_parallel"] >= 2, "parallel Explorer configured")
    check(config["ship"]["max_repair_rounds"] == 2, "bounded automatic repair rounds")

    pi_settings = json.loads(settings.read_text())
    check(pi_settings["tuiMode"] == "fullscreen", "fullscreen Pi TUI remains configured")

    workflow = (ROOT / "WORKFLOW.md").read_text()
    readme = (ROOT / "README.md").read_text()
    check("Lavish" in workflow and "Lavish" in readme, "Lavish review UX documented")
    check("workflow_brief" not in workflow and "workflow_brief" not in readme, "retired review UI not documented")
    check("No model tokens are consumed while waiting" in workflow, "await stays traditional tooling only")
    check("ship.toon" in workflow, "minimal durable ship state documented")
    check("No orchestrator agent" in workflow, "no orchestrator")

    root_agents = (ROOT / "AGENTS.md").read_text()
    global_agents = guidelines.read_text()
    for required in ["No duplication or contradiction", "Least-privilege scope", "Do not teach defaults"]:
        check(required in root_agents, f"instruction invariant: {required}")
    check(len(global_agents.encode()) < 500, "global preferences remain tiny")

    install = (ROOT / "install.sh").read_text()
    check("@toon-format/cli" in install, "TOON CLI installed")
    check("lavish-axi" in install, "Lavish installed")
    check("pi-coding-agent" in install, "Pi installed")

    check(not (skills / "dev-build").exists(), "build is extension driver, not skill")
    check(not (skills / "dev-ship").exists(), "ship is extension driver, not skill")
    check("/plans/" in (ROOT / ".gitignore").read_text(), "workflow artifacts ignored")

    for p in (ROOT / "tests").glob("*.py"):
        ast.parse(p.read_text())
        checks.append(f"python syntax {p.name}")

    print(json.dumps({"status": "PASS", "assertions": len(checks)}, indent=2))


if __name__ == "__main__":
    main()
