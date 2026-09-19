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

    omp = ROOT / "dotfiles/.omp/agent"
    skills = omp / "skills"
    agents = omp / "agents"
    commands = omp / "commands"
    config = omp / "config.yml"
    global_agents = omp / "AGENTS.md"

    check(omp.is_dir() and config.is_file() and global_agents.is_file(), "OMP agent assets present")
    check(not (ROOT / "dotfiles/.pi").exists(), "retired Pi workflow assets removed")
    check(not (ROOT / "dotfiles/.agents").exists(), "legacy cross-harness skills removed")

    expected_skills = {"dev-spec", "dev-plan", "dev-implement", "dev-prepare", "dev-review"}
    actual_skills = {p.name for p in skills.iterdir() if p.is_dir()}
    check(actual_skills == expected_skills, f"exact OMP workflow skills: {actual_skills}")

    skill_content = {name: (skills / name / "SKILL.md").read_text() for name in expected_skills}
    for name, text in skill_content.items():
        check(f"name: {name}" in text, f"{name} frontmatter")
        check(len(text.encode()) < 2000, f"{name} remains compact")
        check("workflow_brief" not in text and "Lavish" not in text, f"{name} has no retired review UI")

    check("Challenge ambiguity" in skill_content["dev-spec"], "spec semantics")
    check("Dispatched plans are immutable" in skill_content["dev-plan"] and "supersedes" in skill_content["dev-plan"], "plan replacement semantics")
    check("Conventional Commit" in skill_content["dev-implement"] and "NEEDS_REPLAN" in skill_content["dev-implement"], "implement contract")
    check("lease protection" in skill_content["dev-prepare"] and "draft" in skill_content["dev-prepare"], "prepare boundary")
    check("Red CI is evidence" in skill_content["dev-review"] and "PASS means no material issue found" in skill_content["dev-review"], "review standard")

    expected_agents = {
        "dev-specifier": "@spec",
        "dev-planner": "@plan",
        "dev-builder": "@builder",
        "dev-builder-retry": "@builder_retry",
        "dev-preparer": "@prepare",
        "dev-reviewer": "@review",
    }
    actual_agents = {p.stem for p in agents.glob("*.md")}
    check(actual_agents == set(expected_agents), f"exact OMP task agents: {actual_agents}")
    for name, role in expected_agents.items():
        text = (agents / f"{name}.md").read_text()
        check(f'model: "{role}"' in text, f"{name} role model")
        check("spawns: scout" in text, f"{name} can delegate scout")
        check("blocking: true" in text, f"{name} is parent-synchronous")
        check("autoloadSkills:" in text, f"{name} autoloads role skill")

    expected_commands = {"dev-spec", "dev-plan", "dev-build", "dev-prepare", "dev-review", "dev-ship"}
    actual_commands = {p.stem for p in commands.glob("*.md")}
    check(actual_commands == expected_commands, f"exact OMP commands: {actual_commands}")
    command_content = {name: (commands / f"{name}.md").read_text() for name in expected_commands}
    for name, text in command_content.items():
        check(len(text.encode()) < 3500, f"{name} command stays compact")
        check("workflow_brief" not in text and "ctx.ui" not in text, f"{name} uses native OMP surfaces")

    check("native `ask`" in command_content["dev-spec"] and "mermaid" in command_content["dev-spec"], "spec uses ask + optional Mermaid")
    check("native `ask`" in command_content["dev-plan"] and "mermaid" in command_content["dev-plan"], "plan uses ask + optional Mermaid")
    check("native `todo`" in command_content["dev-build"] and "dev-builder-retry" in command_content["dev-build"], "build uses native todo/task agents")
    check("dev-reviewer" in command_content["dev-review"] and "native `ask`" in command_content["dev-review"], "manual review uses native reviewer + ask")
    check("native `todo`" in command_content["dev-ship"] and "omp config path" in command_content["dev-ship"], "ship composes native command contracts")
    check("at most two automatic repair rounds" in command_content["dev-ship"], "bounded automatic repair loop")

    cfg = config.read_text()
    for role in ["default", "spec", "plan", "builder", "builder_retry", "explorer", "prepare", "review"]:
        check(f"  {role}:" in cfg, f"OMP model role {role}")
    check('scout: "@explorer"' in cfg, "bundled scout routed to Explorer model")
    check("renderMermaid: true" in cfg, "native Mermaid rendering enabled")
    check("mouse: true" in cfg, "OMP mouse enabled")
    check("github:\n  enabled: true" in cfg, "OMP GitHub tool enabled")

    prefs = global_agents.read_text()
    check(len(prefs.encode()) < 700, "global OMP prompt remains user-wide and compact")
    check("`scout`" in prefs, "universal scout delegation preference")

    root_agents = (ROOT / "AGENTS.md").read_text()
    for invariant in ["No duplication or contradiction", "Least-privilege scope", "Do not teach defaults"]:
        check(invariant in root_agents, f"instruction invariant: {invariant}")
    check("Native OMP primitives" in root_agents, "do not recreate OMP infrastructure")

    workflow = (ROOT / "WORKFLOW.md").read_text()
    readme = (ROOT / "README.md").read_text()
    for required in ["OMP is the harness", "Agent Hub", "`scout`", "`todo`", "`ask`", "Mermaid"]:
        check(required in workflow or required in readme, f"OMP integration documented: {required}")
    check("workflow_brief" not in workflow and "custom workflow TUI" not in workflow, "old rich-review framework removed")
    check("ship.toon" not in workflow, "custom ship controller state removed")
    check("progress.toon" in workflow and "review.toon" in workflow, "minimal restart state retained")
    check("Conventional Commit" in workflow and "no workflow ID" in workflow, "clean Git history documented")

    install = (ROOT / "install.sh").read_text()
    check("can1357/tap/omp" in install and "@toon-format/cli" in install, "OMP + TOON installed")
    check("pi-coding-agent" not in install and "pi install" not in install, "Pi harness/plugins removed")
    for retired in ["pi-lsp", "pi-github-pr", "pi-chrome-devtools", "pi-web-access", "pi-mcp-adapter"]:
        check(retired not in install, f"retired plugin removed: {retired}")

    just = (ROOT / "Justfile").read_text()
    check("check_pi_extension" not in just and "validate_assets.py" in just, "fast tests no longer emulate Pi extension")

    for p in (ROOT / "tests").glob("*.py"):
        ast.parse(p.read_text())
        checks.append(f"python syntax {p.name}")

    print(json.dumps({"status": "PASS", "assertions": len(checks)}, indent=2))


if __name__ == "__main__":
    main()
