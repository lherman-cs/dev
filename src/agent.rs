//! A launcher, not an agent harness. Pi owns authentication and sessions.
use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use std::{collections::HashMap, env, fs, path::PathBuf, process::Command};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Roles {
    auth_provider: String,
    roles: HashMap<String, String>,
}

fn phase_args(config: &Roles, phase: &str, prompt: &[String]) -> Result<Vec<String>> {
    let selection = config.roles.get(phase).ok_or_else(|| anyhow!("Unknown workflow role: {phase}"))?;
    let (provider, model_effort) = selection.split_once('/').ok_or_else(|| anyhow!("Invalid role: {selection}"))?;
    let (model, effort) = model_effort.rsplit_once(':').ok_or_else(|| anyhow!("Invalid role: {selection}"))?;
    if provider != "openai" || model.is_empty() || !["low", "medium", "high"].contains(&effort) {
        bail!("Invalid workflow model/effort: {selection}");
    }
    if !["openai-codex", "openai"].contains(&config.auth_provider.as_str()) {
        bail!("Use authProvider openai-codex for a subscription, or openai for an API key");
    }
    let mut args = vec!["--provider".into(), config.auth_provider.clone(), "--model".into(), model.into(), "--thinking".into(), effort.into()];
    if !prompt.is_empty() {
        args.extend(["--".into(), format!("/dev-{phase} {}", prompt.join(" "))]);
    }
    Ok(args)
}

pub fn launch(phase: Option<&str>, prompt: Vec<String>, resume: Option<Option<String>>) -> Result<()> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Cannot determine home directory"))?;
    let agent_dir = env::var_os("PI_CODING_AGENT_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".pi/agent"));
    let package = env::var_os("DEV_PI_PACKAGE").map(PathBuf::from).unwrap_or_else(|| agent_dir.join("dev-workflow"));
    let config: Roles = serde_json::from_str(&fs::read_to_string(package.join("roles.json"))
        .context("Pi workflow is not installed. Run ./install.sh once.")?)?;
    let mut command = Command::new(package.join("node_modules/.bin/pi"));
    if let Some(session) = resume {
        match session {
            Some(session) if !session.trim().is_empty() => { command.arg("--session").arg(session); }
            Some(_) => bail!("Session ID/path must not be empty"),
            None => { command.arg("--continue"); }
        }
    } else if let Some(phase) = phase {
        command.args(phase_args(&config, phase, &prompt)?);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        Err(command.exec()).context("Could not launch the installed Pi runtime")
    }
    #[cfg(not(unix))]
    {
        let status = command.status().context("Could not launch Pi")?;
        if !status.success() { bail!("Pi exited with {status}"); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn roles() -> Roles { serde_json::from_str(include_str!("../pi/roles.json")).unwrap() }
    #[test]
    fn every_phase_is_interactive_until_invoked() {
        for phase in ["spec", "plan", "build", "prepare", "review", "ship"] {
            let args = phase_args(&roles(), phase, &[]).unwrap();
            assert_eq!(args.len(), 6);
            assert_eq!(&args[..2], &["--provider", "openai-codex"]);
        }
    }
    #[test]
    fn paths_and_prompts_are_not_parsed_by_the_launcher() {
        let prompt = vec!["./plans/media signaling core/spec.md".into()];
        assert_eq!(phase_args(&roles(), "build", &prompt).unwrap().last().unwrap(), "/dev-build ./plans/media signaling core/spec.md");
    }
    #[test]
    fn all_model_and_effort_selections_are_preserved() {
        for (name, selection) in &roles().roles {
            let args = phase_args(&roles(), name, &[]).unwrap();
            assert_eq!(format!("openai/{}:{}", args[3], args[5]), *selection);
        }
    }
}
