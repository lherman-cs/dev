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
    ext = omp / "extensions/dev-workflow.ts"
    workflow_cfg = omp / "dev-workflow.yml"
    skills = omp / "skills"
    check(ext.is_file() and workflow_cfg.is_file(), "OMP driver + workflow config present")
    check(not (omp / "config.yml").exists(), "user OMP config is not repository-managed")
    check(not (omp / "commands").exists(), "no prompt-relay workflow commands")
    check(not (omp / "agents").exists(), "no relay-only specialist wrappers")

    expected_skills = {"dev-spec", "dev-plan", "dev-implement", "dev-prepare", "dev-review"}
    actual_skills = {p.name for p in skills.iterdir() if p.is_dir()}
    check(actual_skills == expected_skills, f"exact workflow skills: {actual_skills}")
    for name in expected_skills:
        text = (skills / name / "SKILL.md").read_text()
        check(f"name: {name}" in text, f"{name} frontmatter")
        check(len(text.encode()) < 2000, f"{name} remains compact")
        check("workflow_brief" not in text and "Lavish" not in text, f"{name} has no retired UI")

    driver = ext.read_text()
    for command in ["dev-spec", "dev-plan", "dev-build", "dev-prepare", "dev-review", "dev-ship"]:
        check(f'registerCommand("{command}"' in driver, f"deterministic /{command} command")
    for required in [
        'spawn("omp"',
        '"--mode", "json"',
        '"--no-session"',
        '"--model", `@${role}`',
        'const BUILD_MAX_ATTEMPTS = 2',
        'const SHIP_MAX_REPAIR_ROUNDS = 2',
        'async function driveBuild',
        'async function driveShip',
        'async function awaitShipSignals',
        'async function prepareShipCandidate',
        'async function runShipReviewer',
        'async function finalHumanReview',
        'ctx.ui.askDialog',
        'function workflowConfigArgs',
        'dev-workflow.local.yml',
        '"task", "hub"',
        'ship.toon',
        '--force-with-lease',
        'CONVENTIONAL_COMMIT_RE',
        '"ls-files", "--", "plans"',
        '"rev-parse", "--git-path", "info/exclude"',
    ]:
        check(required in driver, f"driver invariant: {required}")

    for forbidden in [
        'workflow_brief', 'RichBriefView', 'registerExploreTool', 'DEV_WORKFLOW_CHILD',
        'DEV_WORKFLOW_EXPLORER', 'spawn("pi"', 'launchSkill(', 'resolvedRoleProfile(', 'recentConversation(', 'driveSpec(', 'drivePlan(',
    ]:
        check(forbidden not in driver, f"retired relay/plumbing absent: {forbidden}")

    check('readSkill("dev-implement")' in driver and 'readSkill("dev-review")' in driver, "workers consume semantic skills directly")
    check('role: "review"' in driver and 'role: "ship"' in driver, "review/finalizer are direct workers")
    check('role = attempt === 1 ? "build" : "build_retry"' in driver, "build retry role is deterministic")
    check('pi.sendUserMessage(`/skill:${skill}' in driver, "Spec/Plan aliases route through native skill commands")

    config = workflow_cfg.read_text()
    for role in ["spec", "plan", "build", "build_retry", "prepare", "review", "ship", "explorer"]:
        check(f"  {role}:" in config, f"workflow model role {role}")
    check('scout: "@explorer"' in config, "OMP scout uses explorer role")
    check("renderMermaid: true" in config, "Mermaid rendering enabled")

    workflow = (ROOT / "WORKFLOW.md").read_text()
    readme = (ROOT / "README.md").read_text()
    check("Code decides workflow; models decide engineering" in workflow, "driver invariant documented")
    check("dev a <phase>" in workflow, "symmetric launcher documented")
    check("/dev-spec" in workflow and "/dev-ship" in workflow, "symmetric slash commands documented")
    check("ship.toon" in workflow and "progress.toon" in workflow, "restartable state documented")
    check(".git/info/exclude" in workflow, "local workflow-state ignore documented")
    check("~/.omp/agent/config.yml" in workflow and "never" in workflow.lower(), "user OMP config ownership documented")

    root_agents = (ROOT / "AGENTS.md").read_text()
    for invariant in ["No duplication or contradiction", "Least-privilege scope", "Do not teach defaults"]:
        check(invariant in root_agents, f"instruction invariant: {invariant}")
    check("Do not route deterministic workflow phases through a foreground orchestrator model" in root_agents, "orchestrator regression guard")
    check("Never manage or overwrite `~/.omp/agent/config.yml`" in root_agents, "user OMP config guard")

    src = (ROOT / "src/main.rs").read_text()
    for phase in ["spec", "plan", "build", "prepare", "review", "ship"]:
        check(f'exec_omp_phase("{phase}", prompt)' in src, f"dev a {phase} launcher")
    check('format!("/dev-{phase} {}", prompt.join(" "))' in src, "prompted launch routes through symmetric slash command")
    check('omp_phase_args("spec", &[])' in src and 'omp_phase_args("ship", &[])' in src, "bare launch has no user turn regression tests")
    check('command.arg("--continue")' in src, "dev a resume uses OMP continue")
    check('dev-workflow.local.yml' in src, "launcher supports unmanaged local workflow overrides")

    install = (ROOT / "install.sh").read_text()
    check("can1357/tap/omp" in install and "@toon-format/cli" in install, "OMP + TOON installed")
    check('"$HOME/.omp/agent/commands"/dev-*.md' in install, "stale relay commands cleaned")
    check('"$HOME/.omp/agent/agents"/dev-*.md' in install, "stale relay agents cleaned")
    check("preserving ~/.omp/agent/config.yml" in install, "installer preserves user OMP config")
    check("pi install" not in install and "pi-coding-agent" not in install, "Pi harness/plugins remain removed")

    for p in (ROOT / "tests").glob("*.py"):
        ast.parse(p.read_text())
        checks.append(f"python syntax {p.name}")

    print(json.dumps({"status": "PASS", "assertions": len(checks)}, indent=2))

if __name__ == "__main__":
    main()
