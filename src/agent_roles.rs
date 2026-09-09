//! Shared native/managed role definitions: no second, divergent model-selection policy.
use anyhow::{Context, Result, bail};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct Role {
    pub name: String,
    pub description: String,
    pub model: String,
    pub model_reasoning_effort: String,
    pub sandbox_mode: String,
    pub developer_instructions: String,
}
pub fn load(name: &str) -> Result<Role> {
    let source = match name {
        "builder" => include_str!("../dotfiles/.codex/agents/builder.toml"),
        "reviewer" => include_str!("../dotfiles/.codex/agents/reviewer.toml"),
        "planner" => include_str!("../dotfiles/.codex/agents/planner.toml"),
        "orchestrator" => include_str!("../dotfiles/.codex/agents/orchestrator.toml"),
        "explorer" => include_str!("../dotfiles/.codex/agents/explorer.toml"),
        _ => bail!("unknown agent role {name}"),
    };
    let role: Role = toml::from_str(source).context("invalid embedded agent role")?;
    anyhow::ensure!(
        role.name == name && !role.description.trim().is_empty(),
        "inconsistent embedded role identity"
    );
    anyhow::ensure!(
        matches!(role.sandbox_mode.as_str(), "read-only" | "workspace-write"),
        "unsupported role sandbox"
    );
    Ok(role)
}
pub fn skill(role: &str) -> &'static str {
    match role {
        "builder" => include_str!("../dotfiles/.agents/skills/dev-build/SKILL.md"),
        "reviewer" => include_str!("../dotfiles/.agents/skills/dev-review/SKILL.md"),
        "planner" => include_str!("../dotfiles/.agents/skills/dev-plan/SKILL.md"),
        "orchestrator" => include_str!("../dotfiles/.agents/skills/dev-project/SKILL.md"),
        _ => "Answer the assigned factual repository question; do not modify source.",
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roles_and_skills_are_consistent() {
        for name in ["builder", "reviewer", "planner", "orchestrator", "explorer"] {
            let r = load(name).unwrap();
            assert_eq!(r.name, name);
            assert!(!r.description.is_empty() && !r.model.is_empty());
            assert!(skill(name).lines().count() <= 100);
        }
    }
}
