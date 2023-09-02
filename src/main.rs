mod ws;

use clap::{Args, Parser, Subcommand};
use anyhow::Result;
use ws::hello;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Adds files to myapp
    Workspace {
        #[command(subcommand)]
        command: WorkspaceCommands,
    },
}


#[derive(Subcommand)]
enum WorkspaceCommands {
    Init,
}

fn main() -> Result<()> {
    // let cli = Cli::parse();
    hello()?;
    Ok(())
}
