//! A launcher, not an agent harness. Pi owns authentication and sessions.
use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Roles {
    auth_provider: String,
    roles: HashMap<String, String>,
}

fn load_roles(package: &Path) -> Result<Roles> {
    // Use the same pinned TOON decoder as Pi, rather than maintaining a second parser.
    let script = "import { decode } from '@toon-format/toon'; import { readFileSync } from 'node:fs'; process.stdout.write(JSON.stringify(decode(readFileSync('roles.toon', 'utf8'), { strict: true })));";
    let output = Command::new("node")
        .current_dir(package)
        .args(["--input-type=module", "-e", script])
        .output()
        .with_context(|| format!("Could not decode {}", package.join("roles.toon").display()))?;
    if !output.status.success() {
        bail!(
            "Could not decode {}: {}",
            package.join("roles.toon").display(),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    serde_json::from_slice(&output.stdout).context("Invalid roles.toon configuration")
}

fn phase_args(config: &Roles, phase: &str, prompt: &[String]) -> Result<Vec<String>> {
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
    if !prompt.is_empty() {
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
    fn role_comments_decode_from_the_shared_toon_file() {
        assert_eq!(roles().roles["spec"], "openai/gpt-6-astra:medium");
        assert_eq!(roles().roles["assessor"], "openai/gpt-6-sol:high");
    }
    #[test]
    fn every_phase_is_interactive_until_invoked() {
        for phase in ["spec", "build", "ship"] {
            let args = phase_args(&roles(), phase, &[]).unwrap();
            assert_eq!(args.len(), 6);
            assert_eq!(&args[..2], &["--provider", "openai-codex"]);
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
    fn all_model_and_effort_selections_are_preserved() {
        for (name, selection) in &roles().roles {
            let args = phase_args(&roles(), name, &[]).unwrap();
            assert_eq!(format!("openai/{}:{}", args[3], args[5]), *selection);
        }
    }
}
