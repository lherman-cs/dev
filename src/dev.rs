mod workflow;

use anyhow::{Context, Result};
use clap::Parser;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Parser)]
#[command(name = "dev workflow", about = "Deterministic project workflow middleware")]
struct WorkflowCli {
    #[command(subcommand)]
    action: workflow::WorkflowAction,
}

fn core_binary() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("resolve dev executable")?;
    let name = if cfg!(windows) { "dev-core.exe" } else { "dev-core" };
    Ok(exe.with_file_name(name))
}

fn core_args(mut args: Vec<OsString>, jobs_alias: bool) -> Vec<OsString> {
    if jobs_alias && args.len() > 1 {
        args[1] = OsString::from("workflow");
    }
    args.into_iter().skip(1).collect()
}

fn run_core(args: Vec<OsString>, jobs_alias: bool) -> Result<()> {
    let core = core_binary()?;
    let forwarded = core_args(args, jobs_alias);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let error = Command::new(&core).args(forwarded).exec();
        Err(error).with_context(|| format!("exec {}", core.display()))
    }
    #[cfg(not(unix))]
    {
        let status = Command::new(&core).args(forwarded).status()
            .with_context(|| format!("run {}", core.display()))?;
        std::process::exit(status.code().unwrap_or(1));
    }
}

fn print_help() -> Result<()> {
    let core = core_binary()?;
    let output = Command::new(&core).arg("--help").stdout(Stdio::piped()).output()
        .with_context(|| format!("run {} --help", core.display()))?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text = text.replace(
        "  workflow  Create a new workflow",
        "  jobs      Manage legacy shell job collections\n  workflow  Run deterministic project workflow middleware",
    );
    print!("{text}");
    Ok(())
}

fn run() -> Result<()> {
    let args: Vec<OsString> = std::env::args_os().collect();
    let first = args.get(1).and_then(|s| s.to_str());
    match first {
        Some("workflow") => {
            let parse_args = std::iter::once(OsString::from("dev workflow"))
                .chain(args.into_iter().skip(2));
            let cli = WorkflowCli::parse_from(parse_args);
            workflow::run(cli.action)
        }
        Some("jobs") => run_core(args, true),
        Some("--help" | "-h") => print_help(),
        _ => run_core(args, false),
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jobs_alias_maps_only_the_subcommand() {
        let args = vec!["dev", "jobs", "list"].into_iter().map(OsString::from).collect();
        assert_eq!(core_args(args, true), vec![OsString::from("workflow"), OsString::from("list")]);
    }

    #[test]
    fn ordinary_commands_are_forwarded_unchanged() {
        let args = vec!["dev", "a", "plan", "task"].into_iter().map(OsString::from).collect();
        assert_eq!(core_args(args, false), vec![OsString::from("a"), OsString::from("plan"), OsString::from("task")]);
    }
}
