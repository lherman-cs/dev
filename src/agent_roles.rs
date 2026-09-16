//! Canonical workflow-role assets. Root profiles and spawned roles share one model policy.
use anyhow::{Context, Result, bail, ensure};
use serde::Deserialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

pub struct Asset {
    pub name: &'static str,
    pub skill_name: Option<&'static str>,
    pub role_source: &'static str,
    pub skill_source: Option<&'static str>,
}

macro_rules! role_with_skill {
    ($name:literal, $skill:literal) => {
        Asset {
            name: $name,
            skill_name: Some($skill),
            role_source: include_str!(concat!("../dotfiles/.codex/agents/", $name, ".toml")),
            skill_source: Some(include_str!(concat!("../dotfiles/.agents/skills/", $skill, "/SKILL.md"))),
        }
    };
}

macro_rules! role_only {
    ($name:literal) => {
        Asset {
            name: $name,
            skill_name: None,
            role_source: include_str!(concat!("../dotfiles/.codex/agents/", $name, ".toml")),
            skill_source: None,
        }
    };
}

pub const ALL: &[Asset] = &[
    role_with_skill!("specifier", "dev-spec"),
    role_with_skill!("planner", "dev-plan"),
    role_with_skill!("builder", "dev-build"),
    role_with_skill!("builder_strong", "dev-build"),
    role_with_skill!("reviewer", "dev-review"),
    role_with_skill!("reviewer_strong", "dev-review"),
    role_with_skill!("orchestrator", "dev-project"),
    role_only!("explorer"),
];

pub struct ExtraAsset {
    pub path: &'static str,
    pub source: &'static str,
}

pub const EXTRA_ASSETS: &[ExtraAsset] = &[
    ExtraAsset { path: "skills/dev-project/prompts/explore-facts.md", source: include_str!("../dotfiles/.agents/skills/dev-project/prompts/explore-facts.md") },
    ExtraAsset { path: "skills/dev-project/prompts/plan-project.md", source: include_str!("../dotfiles/.agents/skills/dev-project/prompts/plan-project.md") },
    ExtraAsset { path: "skills/dev-project/prompts/replan-project.md", source: include_str!("../dotfiles/.agents/skills/dev-project/prompts/replan-project.md") },
    ExtraAsset { path: "skills/dev-project/prompts/build-task.md", source: include_str!("../dotfiles/.agents/skills/dev-project/prompts/build-task.md") },
    ExtraAsset { path: "skills/dev-project/prompts/fix-task.md", source: include_str!("../dotfiles/.agents/skills/dev-project/prompts/fix-task.md") },
    ExtraAsset { path: "skills/dev-project/prompts/task-review.md", source: include_str!("../dotfiles/.agents/skills/dev-project/prompts/task-review.md") },
    ExtraAsset { path: "skills/dev-project/prompts/scoped-rereview.md", source: include_str!("../dotfiles/.agents/skills/dev-project/prompts/scoped-rereview.md") },
    ExtraAsset { path: "skills/dev-project/prompts/final-review.md", source: include_str!("../dotfiles/.agents/skills/dev-project/prompts/final-review.md") },
    ExtraAsset { path: "skills/dev-project/prompts/report-contract.md", source: include_str!("../dotfiles/.agents/skills/dev-project/prompts/report-contract.md") },
    ExtraAsset { path: "skills/dev-project/prompts/progress-template.md", source: include_str!("../dotfiles/.agents/skills/dev-project/prompts/progress-template.md") },
    ExtraAsset { path: "skills/dev-project/scripts/package_task.py", source: include_str!("../dotfiles/.agents/skills/dev-project/scripts/package_task.py") },
    ExtraAsset { path: "skills/dev-project/scripts/package_review.py", source: include_str!("../dotfiles/.agents/skills/dev-project/scripts/package_review.py") },
    ExtraAsset { path: "skills/dev-project/scripts/review_report.py", source: include_str!("../dotfiles/.agents/skills/dev-project/scripts/review_report.py") },
    ExtraAsset { path: "skills/dev-project/scripts/validate_workflow.py", source: include_str!("../dotfiles/.agents/skills/dev-project/scripts/validate_workflow.py") },
    ExtraAsset { path: "skills/dev-project/scripts/prepare_workspace.py", source: include_str!("../dotfiles/.agents/skills/dev-project/scripts/prepare_workspace.py") },
];

#[derive(Debug, Deserialize)]
pub struct Role {
    pub name: String,
    pub description: String,
    pub model: String,
    pub model_reasoning_effort: String,
    pub default_permissions: String,
    pub developer_instructions: String,
}

pub fn asset(name: &str) -> Result<&'static Asset> {
    ALL.iter().find(|a| a.name == name).with_context(|| format!("Unknown agent role {name:?}"))
}

pub fn load(name: &str) -> Result<Role> {
    let a = asset(name)?;
    let r: Role = toml::from_str(a.role_source).with_context(|| format!("Invalid role {name}"))?;
    ensure!(r.name == name, "Mismatched role identity: {name}");
    ensure!(!r.description.trim().is_empty() && !r.model.trim().is_empty(), "Incomplete role {name}");
    ensure!(matches!(r.model_reasoning_effort.as_str(), "low" | "medium" | "high" | "xhigh" | "max"), "Invalid effort for {name}");
    ensure!(matches!(r.default_permissions.as_str(), "dev-explorer" | "dev-workspace" | "dev-builder"), "Invalid permissions for {name}");
    ensure!(!r.developer_instructions.trim().is_empty(), "Missing instructions for {name}");
    Ok(r)
}

/// A cache namespace, not a security digest. Exact contents are checked before reuse.
pub fn runtime_dir(codex_home: &Path) -> PathBuf {
    let mut h = DefaultHasher::new();
    "dev-workflow-v2".hash(&mut h);
    for a in ALL {
        a.role_source.hash(&mut h);
        a.skill_source.hash(&mut h);
    }
    for a in EXTRA_ASSETS {
        a.path.hash(&mut h);
        a.source.hash(&mut h);
    }
    codex_home.join("dev-workflow").join(format!("{:016x}", h.finish()))
}

pub fn skill_path(dir: &Path, name: &str) -> Result<PathBuf> {
    let skill = asset(name)?.skill_name.with_context(|| format!("Role {name:?} has no public skill"))?;
    Ok(dir.join("skills").join(skill).join("SKILL.md"))
}

/// Runtime copies are derived, never a second editable source of model selection.
/// Keep them for resumed sessions; do not modify ~/.codex/config.toml or global skills.
pub fn materialize(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir).context("Could not create workflow asset cache")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }

    for a in ALL {
        if let Some(source) = a.skill_source {
            write_cached(&skill_path(dir, a.name)?, source)?;
        }
        let mut table: toml::Table = toml::from_str(a.role_source)?;
        if a.skill_name.is_some() {
            let instructions = table.get("developer_instructions").and_then(toml::Value::as_str)
                .context("Role has no developer instructions")?;
            let skill = skill_path(dir, a.name)?;
            let skill = skill.to_str().context("Codex requires UTF-8 workflow asset paths")?;
            table.insert("developer_instructions".into(), toml::Value::String(format!(
                "{instructions}\nUse the exact bundled skill source at {skill:?}; read it before acting.\n"
            )));
        }
        write_cached(&dir.join("agents").join(format!("{}.toml", a.name)), &toml::to_string(&table)?)?;
    }
    for a in EXTRA_ASSETS {
        write_cached(&dir.join(a.path), a.source)?;
    }
    Ok(())
}

fn write_cached(path: &Path, contents: &str) -> Result<()> {
    match fs::read_to_string(path) {
        Ok(existing) if existing == contents => return Ok(()),
        Ok(_) => bail!("Workflow cache differs from embedded assets at {}. Remove this cache directory and retry; do not edit generated copies.", path.display()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e).with_context(|| format!("Read {}", path.display())),
    }
    fs::create_dir_all(path.parent().context("Asset has no parent directory")?)?;
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    let result = (|| -> Result<()> {
        use std::io::Write;
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
        drop(f);
        match fs::rename(&tmp, path) {
            Ok(()) => Ok(()),
            Err(_) if fs::read_to_string(path).ok().as_deref() == Some(contents) => Ok(()),
            Err(e) => Err(e).context("Publish workflow cache asset"),
        }
    })();
    let _ = fs::remove_file(&tmp);
    result.with_context(|| format!("Write workflow asset {}", path.display()))
}

pub fn registration_args(dir: &Path) -> Result<Vec<String>> {
    let mut args = Vec::new();
    for a in ALL {
        let r = load(a.name)?;
        let path = dir.join("agents").join(format!("{}.toml", a.name));
        let path = path.to_str().context("Codex requires UTF-8 workflow asset paths")?;
        for (key, value) in [("config_file", path.to_owned()), ("description", r.description)] {
            args.push("-c".into());
            args.push(format!("agents.{}.{key}={}", a.name, toml::Value::String(value)));
        }
    }
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_are_complete_and_public_skills_are_exactly_five() {
        let mut skills: Vec<_> = ALL.iter().filter_map(|a| a.skill_name).collect();
        skills.sort_unstable(); skills.dedup();
        assert_eq!(skills, vec!["dev-build", "dev-plan", "dev-project", "dev-review", "dev-spec"]);
        for a in ALL {
            let role = load(a.name).unwrap();
            if let (Some(skill), Some(source)) = (a.skill_name, a.skill_source) {
                assert!(source.starts_with("---\n"));
                assert!(source.contains(&format!("name: {skill}")));
            }
            assert!(!role.model.is_empty());
        }
        assert!(load("not_a_role").is_err());
    }

    #[test]
    fn explorer_is_leaf_and_reviewers_are_source_read_only_by_contract() {
        assert_eq!(load("explorer").unwrap().default_permissions, "dev-explorer");
        let explorer: toml::Table = toml::from_str(asset("explorer").unwrap().role_source).unwrap();
        assert_eq!(explorer["agents"]["enabled"].as_bool(), Some(false));
        for name in ["reviewer", "reviewer_strong"] {
            assert!(load(name).unwrap().developer_instructions.contains("repository source as read-only"));
        }
    }

    #[test]
    fn generated_assets_are_idempotent_and_preserve_role_models() {
        let base = std::env::temp_dir().join(format!("dev-assets-{}", std::process::id()));
        let dir = runtime_dir(&base);
        if base.exists() { fs::remove_dir_all(&base).unwrap(); }
        materialize(&dir).unwrap();
        materialize(&dir).unwrap();
        for a in ALL {
            let generated = fs::read_to_string(dir.join("agents").join(format!("{}.toml", a.name))).unwrap();
            let role: Role = toml::from_str(&generated).unwrap();
            let source = load(a.name).unwrap();
            assert_eq!(role.model, source.model);
            assert_eq!(role.model_reasoning_effort, source.model_reasoning_effort);
            if a.skill_name.is_some() {
                assert!(role.developer_instructions.contains(skill_path(&dir, a.name).unwrap().to_str().unwrap()));
                assert_eq!(fs::read_to_string(skill_path(&dir, a.name).unwrap()).unwrap(), a.skill_source.unwrap());
            }
        }
        for extra in EXTRA_ASSETS {
            assert_eq!(fs::read_to_string(dir.join(extra.path)).unwrap(), extra.source);
        }
        fs::write(skill_path(&dir, "builder").unwrap(), "corrupt").unwrap();
        assert!(materialize(&dir).is_err());
        fs::remove_dir_all(base).unwrap();
    }
}
