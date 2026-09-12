//! Canonical role assets. The launcher and spawned agents read the same model policy.
use anyhow::{Context, Result, bail, ensure};
use serde::Deserialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

pub struct Asset {
    pub name: &'static str,
    pub skill_name: &'static str,
    pub role_source: &'static str,
    pub skill_source: &'static str,
}

macro_rules! asset {
    ($name:literal, $skill:literal) => {
        Asset {
            name: $name,
            skill_name: $skill,
            role_source: include_str!(concat!("../dotfiles/.codex/agents/", $name, ".toml")),
            skill_source: include_str!(concat!("../dotfiles/.agents/skills/", $skill, "/SKILL.md")),
        }
    };
}

pub const ALL: &[Asset] = &[
    asset!("specifier", "dev-spec"),
    asset!("planner", "dev-plan"),
    asset!("builder", "dev-build"),
    asset!("reviewer", "dev-review"),
    asset!("orchestrator", "dev-project"),
    asset!("explorer", "dev-explore"),
];

#[derive(Debug, Deserialize)]
pub struct Role {
    pub name: String,
    pub description: String,
    pub model: String,
    pub model_reasoning_effort: String,
    pub sandbox_mode: String,
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
    ensure!(matches!(r.model_reasoning_effort.as_str(), "medium" | "high"), "Invalid effort for {name}");
    ensure!(matches!(r.sandbox_mode.as_str(), "read-only" | "workspace-write"), "Invalid sandbox for {name}");
    ensure!(!r.developer_instructions.trim().is_empty(), "Missing instructions for {name}");
    ensure!(a.role_source.lines().count() < 100 && a.skill_source.lines().count() < 100,
        "Role/skill must stay under 100 physical lines: {name}");
    Ok(r)
}

/// A cache namespace, not a security digest. Exact contents are checked before reuse.
pub fn runtime_dir(codex_home: &Path) -> PathBuf {
    let mut h = DefaultHasher::new();
    // Change this tag when the generated-path/instruction format changes.
    "dev-workflow-v1".hash(&mut h);
    for a in ALL {
        a.role_source.hash(&mut h);
        a.skill_source.hash(&mut h);
    }
    codex_home.join("dev-workflow").join(format!("{:016x}", h.finish()))
}

pub fn skill_path(dir: &Path, name: &str) -> Result<PathBuf> {
    Ok(dir.join("skills").join(asset(name)?.skill_name).join("SKILL.md"))
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
        load(a.name)?;
        let skill = skill_path(dir, a.name)?;
        write_cached(&skill, a.skill_source)?;
        let mut table: toml::Table = toml::from_str(a.role_source)?;
        let instructions = table.get("developer_instructions").and_then(toml::Value::as_str)
            .context("Role has no developer instructions")?;
        let skill = skill.to_str().context("Codex requires UTF-8 workflow asset paths")?;
        let instructions = format!(
            "{instructions}\nUse the exact bundled skill source at {skill:?}; read it before acting.\n"
        );
        table.insert("developer_instructions".into(), toml::Value::String(instructions));
        write_cached(&dir.join("agents").join(format!("{}.toml", a.name)), &toml::to_string(&table)?)?;
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
    // The same process materializes sequentially; unique PIDs separate concurrent launches.
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
    fn roles_are_complete_and_short() {
        for a in ALL {
            let role = load(a.name).unwrap();
            assert!(role.developer_instructions.contains("fork_turns=\"none\""));
            assert!(a.skill_source.starts_with("---\n"));
            assert!(a.skill_source.contains(&format!("name: {}", a.skill_name)));
        }
        assert!(load("not_a_role").is_err());
    }

    #[test]
    fn read_only_roles_and_leaf_policy() {
        assert_eq!(load("explorer").unwrap().sandbox_mode, "read-only");
        assert_eq!(load("reviewer").unwrap().sandbox_mode, "read-only");
        let explorer: toml::Table = toml::from_str(asset("explorer").unwrap().role_source).unwrap();
        assert_eq!(explorer["agents"]["enabled"].as_bool(), Some(false));
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
            assert!(role.developer_instructions.contains(skill_path(&dir, a.name).unwrap().to_str().unwrap()));
            assert_eq!(fs::read_to_string(skill_path(&dir, a.name).unwrap()).unwrap(), a.skill_source);
        }
        fs::write(skill_path(&dir, "builder").unwrap(), "corrupt").unwrap();
        assert!(materialize(&dir).is_err());
        fs::remove_dir_all(base).unwrap();
    }
}
