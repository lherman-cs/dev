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
    expected = {"dev-spec", "dev-plan", "dev-prepare", "dev-review"}
    actual = {p.name for p in skills.iterdir() if p.is_dir()}
    check(actual == expected, f"exact workflow skills: {actual}")

    for name in sorted(expected):
        text = (skills / name / "SKILL.md").read_text()
        check(f"name: {name}" in text, f"{name} frontmatter")
        check(len(text.encode()) < 2000, f"{name} remains compact")
        check("Codex" not in text and "Lavish" not in text, f"{name} has no retired harness")

    spec = (skills / "dev-spec/SKILL.md").read_text()
    plan = (skills / "dev-plan/SKILL.md").read_text()
    prepare = (skills / "dev-prepare/SKILL.md").read_text()
    review = (skills / "dev-review/SKILL.md").read_text()

    check("workflow_brief" in spec and "explicit approval" in spec, "spec has rich human gate")
    check("workflow_brief" in plan and "explicit approval" in plan, "plan has rich human gate")
    check("all approved plans/repairs complete" in prepare and "mechanical/minimal" in prepare, "standalone prepare stays mechanical")
    check("Red CI is evidence" in review and "PASS means no material issue found" in review, "review is conservative and terminal-red aware")
    check("Use approved spec + plans/repairs" in review and "deselect/filter" in review, "review consumes full evidence and keeps human repair control")
    check("Challenge ambiguity" in spec and "open decisions" in spec, "spec preserves challenge and decision requirements")
    check("Dispatched plans are immutable" in plan and "supersedes" in plan and "not ordinary debugging" in plan, "plan preserves immutable replacement semantics")

    ext = ROOT / "dotfiles/.pi/agent/extensions/dev-workflow.ts"
    cfg = ROOT / "dotfiles/.pi/agent/dev-workflow.json"
    settings = ROOT / "dotfiles/.pi/agent/settings.json"
    guidelines = ROOT / "dotfiles/.pi/agent/AGENTS.md"
    check(ext.is_file(), "Pi extension present")
    check(cfg.is_file(), "model config present")
    check(settings.is_file(), "Pi settings present")
    check(guidelines.is_file(), "global guidelines present")

    ext_text = ext.read_text()
    for command in ["dev-spec", "dev-plan", "dev-build", "dev-prepare", "dev-review", "dev-ship"]:
        check(f'registerCommand("{command}"' in ext_text, f"Pi command /{command}")
    check('name: "workflow_brief"' in ext_text, "rich workflow brief tool")
    check('name: "explore"' in ext_text, "Explorer tool")
    check("handleMouse(event)" in ext_text and "new Image(" in ext_text and "new Markdown(" in ext_text, "rich mouse/image/markdown UI")
    check("isMermaid" in ext_text and "code_language" in ext_text and "Evidence / links" in ext_text, "rich diagrams/code/clickable evidence UI")
    check('ctx.ui.editor("Review feedback"' in ext_text, "multi-line human feedback path")
    check("resolvedRoleProfile" in ext_text and "${model.provider}/${model.id}" in ext_text, "child agents use resolved exact model identity")
    check('"--mode", "json"' in ext_text and '"--no-session"' in ext_text, "fresh streamed child sessions")
    check("Plan-ID:" in ext_text and "max_attempts_per_plan" in ext_text, "bounded deterministic plan commits")
    check("DEV_WORKFLOW_EXPLORER" in ext_text and "read-only" in ext_text, "Explorer read-only enforcement")
    check("async function driveShip" in ext_text and "async function awaitShipSignals" in ext_text, "deterministic shipping driver")
    check("DEV_WORKFLOW_SHIP" not in ext_text, "no hidden ship mode")
    check("shipReviewerSystem" in ext_text and "finalizerSystem" in ext_text and "--force-with-lease" in ext_text, "ship workers have explicit internal contracts")
    check("fs.renameSync(temp, file)" in ext_text, "workflow TOON writes are atomic")
    for forbidden in ["sqlite", "event sourcing"]:
        check(forbidden not in ext_text.lower(), f"extension avoids {forbidden}")

    config = json.loads(cfg.read_text())
    expected_models = {"spec", "plan", "builder", "builder_retry", "explorer", "prepare", "review", "ship"}
    check(set(config["models"]) == expected_models, "role-specific model matrix")
    check(config["build"]["max_attempts_per_plan"] == 2, "bounded Builder attempts")
    check(config["explorer"]["max_parallel"] >= 2, "parallel Explorer configured")
    check(config["ship"]["max_repair_rounds"] == 2, "bounded automatic repair rounds")
    check(config["ship"]["poll_seconds"] >= 5, "cheap GitHub polling cadence")
    for role, profile in config["models"].items():
        check(bool(profile.get("model")) and bool(profile.get("thinking")), f"{role} model is explicit")

    pi_settings = json.loads(settings.read_text())
    check(pi_settings["tuiMode"] == "fullscreen", "fullscreen Pi TUI required")
    check(pi_settings["terminal"]["showImages"] is True, "terminal images enabled")

    workflow = (ROOT / "WORKFLOW.md").read_text()
    readme = (ROOT / "README.md").read_text()
    for text in [workflow, readme]:
        check("/dev-prepare" in text, "documented prepare stage")
        check("workflow_brief" in text, "documented rich Pi review UX")
        check("Explorer" in text, "documented Explorer primitive")
    check("CI may be red or green" in workflow, "terminal CI is review evidence")
    check("No model tokens are consumed while waiting" in workflow, "await is traditional tooling only")
    check("ship.toon" in workflow, "minimal durable ship state documented")
    check("No orchestrator agent" in workflow, "no orchestrator")

    check(not (ROOT / "install-legacy.sh").exists(), "legacy installer removed")
    check(not (ROOT / "workflow-questionnaire.md").exists(), "historical questionnaire removed")
    check(not (ROOT / "skill-requirements.md").exists(), "duplicated workflow requirements removed")
    check(not (skills / "dev-project").exists(), "orchestrator skill removed")
    check(not (skills / "dev-build").exists(), "build is extension driver, not skill")
    check(not (skills / "dev-ship").exists(), "ship is extension driver, not skill")
    check("/plans/" in (ROOT / ".gitignore").read_text(), "workflow artifacts ignored")

    guidelines = (ROOT / "dotfiles" / ".pi" / "agent" / "AGENTS.md").read_text()
    for required in [
        "Do not use em dashes",
        "quality, simplicity, robustness, scalability, and long-term maintainability",
        "reproduce the failure as close as practical to the user-visible boundary",
        "Tests must be fast, deterministic, and useful",
        "delete before adding",
    ]:
        check(required in guidelines, f"engineering guideline: {required}")

    for skill_md in skills.glob("dev-*/SKILL.md"):
        check("/dev-" not in skill_md.read_text(), f"{skill_md.parent.name} does not route to another workflow skill")
    check("## Skill boundary" in workflow, "workflow owns skill sequencing")

    install = (ROOT / "install.sh").read_text()
    check("@earendil-works/pi-coding-agent" in install, "Pi installed")
    check("@toon-format/cli" in install, "TOON CLI installed")
    check("lavish" not in install.lower(), "no Lavish dependency")

    for p in (ROOT / "tests").glob("*.py"):
        ast.parse(p.read_text())
        checks.append(f"python syntax {p.name}")

    print(json.dumps({"status": "PASS", "assertions": len(checks)}, indent=2))


if __name__ == "__main__":
    main()
