mod ws;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    #[clap(alias = "ws")]
    Workspace(ws::WorkspaceArgs),
}

fn parse() -> Result<()> {
    let cli = Cli::parse();
    match &cli.command {
        Commands::Workspace(args) => args.parse()?,
    }

    Ok(())
}

fn main() {
    env_logger::init();

    if let Err(err) = parse() {
        log::error!("{err}");
    }
}
