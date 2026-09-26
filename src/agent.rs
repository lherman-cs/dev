//! A launcher, not an agent harness. Pi owns authentication and sessions.
use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use std::{
    collections::HashMap,
    env,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Roles {
    auth_provider: String,
    roles: HashMap<String, String>,
}

fn load_roles(package: &Path) -> Result<Roles> {
    // Use the same pinned TOML parser as Pi, rather than maintaining a second parser.
    let script = "import { parse } from 'smol-toml'; import { readFileSync } from 'node:fs'; process.stdout.write(JSON.stringify(parse(readFileSync('roles.toml', 'utf8'))));";
    let output = Command::new("node")
        .current_dir(package)
        .args(["--input-type=module", "-e", script])
        .output()
        .with_context(|| format!("Could not parse {}", package.join("roles.toml").display()))?;
    if !output.status.success() {
        bail!(
            "Could not parse {}: {}",
            package.join("roles.toml").display(),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    serde_json::from_slice(&output.stdout).context("Invalid roles.toml configuration")
}

fn phase_args(config: &Roles, phase: &str, prompt: &[String]) -> Result<Vec<String>> {
    if !["spec", "brief", "build", "review", "ship"].contains(&phase) {
        bail!("Unknown workflow phase: {phase}");
    }
    let selection = config
        .roles
        .get(phase)
        .ok_or_else(|| anyhow!("Unknown workflow role: {phase}"))?;
    let (provider, model_effort) = selection
        .split_once('/')
        .ok_or_else(|| anyhow!("Invalid role: {selection}"))?;
    let (model, effort) = model_effort
        .rsplit_once(':')
        .ok_or_else(|| anyhow!("Invalid role: {selection}"))?;
    if provider != "openai" || model.is_empty() || !["low", "medium", "high"].contains(&effort) {
        bail!("Invalid workflow model/effort: {selection}");
    }
    if !["openai-codex", "openai"].contains(&config.auth_provider.as_str()) {
        bail!("Use authProvider openai-codex for a subscription, or openai for an API key");
    }
    let mut args = vec![
        "--provider".into(),
        config.auth_provider.clone(),
        "--model".into(),
        model.into(),
        "--thinking".into(),
        effort.into(),
    ];
    if phase == "ship" {
        args.extend([
            "--".into(),
            if prompt.is_empty() {
                "/dev-ship".into()
            } else {
                format!("/dev-ship {}", prompt.join(" "))
            },
        ]);
    } else if !prompt.is_empty() {
        args.extend(["--".into(), format!("/dev-{phase} {}", prompt.join(" "))]);
    }
    Ok(args)
}

fn resume_args(session: Option<String>) -> Result<Vec<String>> {
    match session {
        Some(session) if !session.trim().is_empty() => Ok(vec!["--session".into(), session]),
        Some(_) => bail!("Session ID/path must not be empty"),
        None => Ok(vec!["--resume".into()]),
    }
}

fn installed_pi() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Cannot determine home directory"))?;
    let agent_dir = env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".pi/agent"));
    let package = env::var_os("DEV_PI_PACKAGE")
        .map(PathBuf::from)
        .unwrap_or_else(|| agent_dir.join("dev-workflow"));
    let executable = package.join("node_modules/.bin/pi");
    if !executable.is_file() {
        bail!(
            "Pinned Pi runtime not found at {}. Run ./install.sh once, or set DEV_PI_PACKAGE.",
            executable.display()
        );
    }
    Ok(executable)
}

fn run_pi(mut command: Command) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        Err(command.exec()).context("Could not launch the installed Pi runtime")
    }
    #[cfg(not(unix))]
    {
        let status = command.status().context("Could not launch Pi")?;
        if !status.success() {
            bail!("Pi exited with {status}");
        }
        Ok(())
    }
}

pub fn generate_brief(root: &Path, tree: &str, input: &str) -> Result<String> {
    let executable = installed_pi()?;
    let package = executable
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .ok_or_else(|| anyhow!("Invalid Pi package path"))?;
    let args = phase_args(&load_roles(package)?, "brief", &[])?;
    let skill = package.join("skills/dev-brief/SKILL.md");
    let mut child = Command::new(&executable)
        .current_dir(root)
        .args(args)
        .args([
            "--no-session",
            "--no-extensions",
            "--no-skills",
            "--no-context-files",
            "--tools",
            "brief_files,brief_read",
            "--extension",
        ])
        .arg(package.join("brief-inspect.ts"))
        .args(["--append-system-prompt"])
        .arg(skill)
        .args([
            "--print",
            "--",
            "Produce the dev-brief typed Markdown from the captured input. Inspect relevant captured source with brief_files and brief_read when the diff is insufficient. Do not execute commands or modify files.",
        ])
        .env("DEV_BRIEF_TREE", tree)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Could not start Pi brief generation")?;
    child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("Pi stdin unavailable"))?
        .write_all(input.as_bytes())?;
    let output = child
        .wait_with_output()
        .context("Pi brief generation failed")?;
    if !output.status.success() {
        bail!(
            "Pi brief generation failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    String::from_utf8(output.stdout).context("Pi output was not UTF-8")
}

pub fn launch_pi(args: Vec<String>) -> Result<()> {
    let executable = installed_pi()?;
    let mut command = Command::new(executable);
    command.args(args);
    run_pi(command)
}

pub fn launch(
    phase: Option<&str>,
    prompt: Vec<String>,
    resume: Option<Option<String>>,
) -> Result<()> {
    let executable = installed_pi()?;
    let package = executable
        .parent()
        .and_then(|bin| bin.parent())
        .and_then(|node_modules| node_modules.parent())
        .ok_or_else(|| {
            anyhow!(
                "Invalid installed Pi runtime path: {}",
                executable.display()
            )
        })?;
    let config = load_roles(package)?;
    let mut command = Command::new(executable);
    if let Some(session) = resume {
        command.args(resume_args(session)?);
    } else if let Some(phase) = phase {
        command.args(phase_args(&config, phase, &prompt)?);
    }
    run_pi(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn roles() -> Roles {
        load_roles(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("pi")).unwrap()
    }
    #[test]
    fn role_comments_parse_from_the_shared_toml_file() {
        assert_eq!(roles().roles["spec"], "openai/gpt-6-sol:high");
        assert_eq!(roles().roles["assessor"], "openai/gpt-6-luna:high");
    }
    #[test]
    fn reasoning_phases_are_interactive_and_ship_runs_immediately() {
        for phase in ["spec", "brief", "build", "review"] {
            let args = phase_args(&roles(), phase, &[]).unwrap();
            assert_eq!(args.len(), 6);
            assert_eq!(&args[..2], &["--provider", "openai-codex"]);
        }
        let ship = phase_args(&roles(), "ship", &[]).unwrap();
        assert_eq!(ship.last().unwrap(), "/dev-ship");
    }
    #[test]
    fn supporting_roles_are_not_public_phases() {
        for phase in ["plan", "explorer", "assessor", "escalated_builder"] {
            assert!(phase_args(&roles(), phase, &[]).is_err());
        }
    }
    #[test]
    fn paths_and_prompts_are_not_parsed_by_the_launcher() {
        let prompt = vec!["./plans/media signaling core/spec.md".into()];
        assert_eq!(
            phase_args(&roles(), "build", &prompt)
                .unwrap()
                .last()
                .unwrap(),
            "/dev-build ./plans/media signaling core/spec.md"
        );
    }
    #[test]
    fn resume_opens_picker_unless_session_is_specified() {
        assert_eq!(resume_args(None).unwrap(), ["--resume"]);
        assert_eq!(
            resume_args(Some("./session.jsonl".into())).unwrap(),
            ["--session", "./session.jsonl"]
        );
        assert!(resume_args(Some("  ".into())).is_err());
    }
    #[test]
    fn public_model_and_effort_selections_are_preserved() {
        let config = roles();
        for name in ["spec", "brief", "build", "review", "ship"] {
            let args = phase_args(&config, name, &[]).unwrap();
            assert_eq!(
                format!("openai/{}:{}", args[3], args[5]),
                config.roles[name]
            );
        }
    }
}
