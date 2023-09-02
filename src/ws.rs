use anyhow::{anyhow, Context, Result};
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;

const CONFIG_FILENAME: &str = ".workspace.toml";
const DEFAULT_RESOLVER: &str = "fd -t d '.git' --hidden | xargs dirname";

#[derive(Subcommand, Debug)]
pub enum Workspace {
    Init {},
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Config {
    resolver: String,
    members: HashMap<String, String>,

    #[serde(skip_serializing, skip_deserializing)]
    updated: bool,

    #[serde(skip_serializing, skip_deserializing)]
    path: String,
}

pub fn hello() -> Result<()> {
    let cfg_path = Config::find_config()?;
    let cfg = Config::load_from_file(cfg_path)?;
    println!("{cfg:?}");
    Ok(())
}

impl Config {
    fn default(path: &str) -> Config {
        Config {
            resolver: DEFAULT_RESOLVER.to_string(),
            members: HashMap::new(),
            updated: false,
            path: path.to_string(),
        }
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
