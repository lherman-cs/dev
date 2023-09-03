use anyhow::Result;
use clap::{Args, Subcommand};
use std::fs;

#[derive(Args)]
pub struct GenArgs {
    #[clap(subcommand)]
    commands: GenCommands,
}

#[derive(Subcommand)]
enum GenCommands {
    Just,
    Flake,
}

impl GenArgs {
    pub fn parse(&self) -> Result<()> {
        match self.commands {
            GenCommands::Just => {
                let raw = include_bytes!("template/justfile");
                fs::write("justfile", raw)?;
            }
            GenCommands::Flake => {
                let raw = include_bytes!("template/flake.nix");
                fs::write("flake.nix", raw)?;
                let raw = include_bytes!("template/devshell.toml");
                fs::write("devshell.toml", raw)?;
            }
        };

        Ok(())
    }
}
