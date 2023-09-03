use anyhow::{anyhow, Context, Result};
use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::Path;
use std::process;

const CONFIG_FILENAME: &str = ".workspace.toml";
const DEFAULT_RESOLVER: &str = "fd -t d '.git' --hidden | xargs dirname";

#[derive(Args)]
pub struct WorkspaceArgs {
    #[clap(subcommand)]
    commands: WorkspaceCommands,
}

#[derive(Subcommand)]
enum WorkspaceCommands {
    Init,
    #[clap(alias = "ls")]
    List {
        sep: String,
    },

    #[clap(alias = "p")]
    Path {
        member: String,
    },

    #[clap(alias = "f")]
    Find {
        path: String,
    },

    Sync,
}

impl WorkspaceArgs {
    pub fn parse(&self) -> Result<()> {
        match self.commands {
            WorkspaceCommands::Init => {
                let mut cwd = env::current_dir()?;
                cwd.push(CONFIG_FILENAME);
                if cwd.as_path().exists() {
                    return Err(anyhow!("workspace is already initialized"));
                }
                let path_str = cwd.to_str().context("failed to encode path")?;
                let cfg = Config::default(path_str);
                cfg.commit()?;
                log::info!("{path_str} has been created");
            }
            WorkspaceCommands::List { ref sep } => {
                let joined_str = ws_member_keys()?.join(&sep);
                print!("{joined_str}");
            }
            WorkspaceCommands::Path { ref member } => {
                let member_path = ws_member_path(member)?;
                print!("{member_path}");
            }
            WorkspaceCommands::Find { ref path } => {
                let longest_match = ws_find_member(path)?;
                let (k, v) = longest_match;
                print!("{k}={v}");
            }
            WorkspaceCommands::Sync => {
                let mut cfg = Config::load()?;
                let cfg_dir = Path::new(&cfg.path)
                    .parent()
                    .context("failed to get parent directory")?;
                env::set_current_dir(cfg_dir)?;
                let output = process::Command::new("sh")
                    .arg("-c")
                    .arg(&cfg.resolver)
                    .current_dir(cfg_dir)
                    .output()?;

                let output_utf8 = std::str::from_utf8(&output.stdout)?;
                let members = output_utf8
                    .split("\n")
                    .filter_map(|ref p| {
                        let path = Path::new(*p);
                        let key = path.file_name()?;
                        let abs_path = path.canonicalize().ok();
                        let key_str = key.to_str()?.to_string();
                        let abs_path_str = abs_path?.to_str()?.to_string();
                        Some((key_str, abs_path_str))
                    })
                    .collect::<HashMap<_, _>>();

                log::info!("members found: {members:?}");
                cfg.members = members;
                cfg.commit()?;
            }
        };

        Ok(())
    }
}

#[derive(Serialize, Deserialize, Debug)]
struct Config {
    resolver: String,
    members: HashMap<String, String>,

    #[serde(skip_serializing, skip_deserializing)]
    path: String,
}

impl Config {
    fn default(path: &str) -> Config {
        Config {
            resolver: DEFAULT_RESOLVER.to_string(),
            members: HashMap::new(),
            path: path.to_string(),
        }
    }

    fn load() -> Result<Config> {
        let cfg_path = Config::find_config()?;
        Config::load_from_file(cfg_path)
    }

    fn load_from_file(path: String) -> Result<Config> {
        let raw = fs::read_to_string(&path)?;
        let mut config: Config = toml::from_str(&raw)?;
        config.path = path;
        Ok(config)
    }

    fn find_config() -> Result<String> {
        let mut cwd = env::current_dir()?;

        loop {
            cwd.push(CONFIG_FILENAME);
            let to_test = cwd.as_path();

            if to_test.exists() && to_test.is_file() {
                let found_path_str = to_test.to_str().context("invalid path encoding")?;
                return Ok(found_path_str.to_string());
            }
            cwd.pop();

            if !cwd.pop() {
                return Err(anyhow!("workspace has not been setup"));
            }
        }
    }

    fn commit(&self) -> Result<()> {
        let encoded = toml::to_string(self)?;
        fs::write(&self.path, encoded)?;

        Ok(())
    }
}

pub fn ws_member_keys() -> Result<Vec<String>> {
    let cfg = Config::load()?;
    let keys = cfg
        .members
        .keys()
        .map(|s| s.clone())
        .collect::<Vec<String>>();
    Ok(keys)
}

pub fn ws_member_path(member: &String) -> Result<String> {
    let cfg = Config::load()?;
    let result = cfg
        .members
        .get(member)
        .context("{member} is not a workspace member")?;
    Ok(result.clone())
}

pub fn ws_find_member(path: &String) -> Result<(String, String)> {
    let cfg = Config::load()?;
    let (k, v) = cfg
        .members
        .iter()
        .filter(|(_, ref v)| path.contains(*v))
        .max_by_key(|(_, ref v)| v.len())
        .context("failed to find a related workspace member")?;
    Ok((k.clone(), v.clone()))
}
