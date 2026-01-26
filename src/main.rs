use anyhow::{Context, Result, anyhow, bail};
use clap::{Parser, Subcommand};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Instant;
use tracing::{Level, error, info, warn};
use tracing_subscriber::FmtSubscriber;

const CONFIG_FILENAME: &str = "workspace.json";
const LOCK_FILENAME: &str = "workspace.lock.json";
const DEFAULT_RESOLVER: &str = "fd -H '^.git$' * | xargs -I{} dirname {}";
const MAKE_FILENAME: &str = "workspace.mk";

#[derive(Parser)]
#[command(name = "workspace")]
#[command(about = "A robust workspace management tool", version, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a new workspace configuration
    Init {
        /// Pattern to search for (will be wrapped in fd command)
        /// Example: "Cargo.toml" becomes "fd -H 'Cargo.toml' * | xargs -I{} dirname {}"
        #[arg(short, long)]
        pattern: Option<String>,
    },

    /// Sync workspace members using the resolver
    Sync,

    /// Display current workspace configuration
    Config,

    /// Run a workflow
    Run {
        /// Name of the workflow to run
        #[arg(short, long)]
        workflow: String,
    },

    /// Find workspace member by path
    Find {
        /// Path to search for
        #[arg(short, long)]
        path: String,
    },

    /// Create symlinks from one directory to another
    Link {
        /// Source directory (defaults to current directory)
        #[arg(short, long)]
        from: Option<PathBuf>,

        /// Target directory (defaults to home directory)
        #[arg(short, long)]
        to: Option<PathBuf>,

        /// Actually create symlinks (dry-run if false)
        #[arg(short, long, default_value = "false")]
        real: bool,

        /// Force overwrite existing files
        #[arg(long, default_value = "false")]
        force: bool,
    },

    /// Filter structured logs from stdin
    Log {
        /// Key-value pairs for filtering (e.g., level error workflow sync)
        filters: Vec<String>,
    },

    /// List all workspace members
    List {
        /// Show full paths instead of just names
        #[arg(short, long)]
        full: bool,

        /// Output format: table (default), json, or paths
        #[arg(short = 'o', long, default_value = "table")]
        output: String,
    },

    /// Add a new member to the workspace
    Add {
        /// Name for the member
        name: String,

        /// Path to the member (defaults to current directory)
        #[arg(short, long)]
        path: Option<PathBuf>,
    },

    /// Remove a member from the workspace
    Remove {
        /// Name of the member to remove
        name: String,
    },

    /// Edit the workspace configuration in your default editor
    Edit,

    /// Validate the workspace configuration
    Validate {
        /// Fix common issues automatically
        #[arg(short, long)]
        fix: bool,
    },

    /// Show information about a specific member
    Info {
        /// Name of the member
        name: String,
    },

    /// Create a new workflow
    Workflow {
        #[command(subcommand)]
        action: WorkflowAction,
    },

    /// Show the path to the workspace root
    Root,

    /// Execute a command in each workspace member
    Exec {
        /// Command to execute
        command: String,

        /// Additional arguments for the command
        args: Vec<String>,

        /// Run in parallel
        #[arg(short, long)]
        parallel: bool,

        /// Members to run on (all if not specified)
        #[arg(short, long)]
        members: Vec<String>,
    },

    /// Show workspace statistics
    Stats,
}

#[derive(Subcommand)]
enum WorkflowAction {
    /// List all workflows
    List,

    /// Add a new workflow
    Add {
        /// Workflow name
        name: String,
    },

    /// Remove a workflow
    Remove {
        /// Workflow name
        name: String,
    },

    /// Add a job to a workflow
    AddJob {
        /// Workflow name
        workflow: String,

        /// Job name
        job: String,

        /// Job script/command
        script: String,
    },

    /// Remove a job from a workflow
    RemoveJob {
        /// Workflow name
        workflow: String,

        /// Job name
        job: String,
    },

    /// Show details of a workflow
    Show {
        /// Workflow name
        name: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Config {
    resolver: String,
    workflows: HashMap<String, HashMap<String, String>>,

    #[serde(skip)]
    dir_path: Option<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LockFile {
    members: HashMap<String, String>,
}

impl Default for Config {
    fn default() -> Self {
        let mut workflows = HashMap::new();
        let mut echo_jobs = HashMap::new();
        echo_jobs.insert("resolver".to_string(), "echo \"{{.Resolver}}\"".to_string());
        workflows.insert("echo".to_string(), echo_jobs);

        Self {
            resolver: DEFAULT_RESOLVER.to_string(),
            workflows,
            dir_path: None,
        }
    }
}

impl Default for LockFile {
    fn default() -> Self {
        Self {
            members: HashMap::new(),
        }
    }
}

/// RAII guard for configuration that auto-commits on drop
struct ConfigGuard {
    config: Config,
    lock: LockFile,
    should_commit: bool,
}

impl ConfigGuard {
    /// Load configuration (read-only, won't auto-commit)
    fn load() -> Result<Self> {
        let (config, lock) = Self::load_files()?;
        Ok(Self {
            config,
            lock,
            should_commit: false,
        })
    }

    /// Load configuration for modification (will auto-commit on drop)
    fn load_mut() -> Result<Self> {
        let (config, lock) = Self::load_files()?;
        Ok(Self {
            config,
            lock,
            should_commit: true,
        })
    }

    fn load_files() -> Result<(Config, LockFile)> {
        let mut current_dir = std::env::current_dir().context("Failed to get current directory")?;

        loop {
            let config_path = current_dir.join(CONFIG_FILENAME);
            if config_path.is_file() {
                let file = File::open(&config_path)?;
                let mut config: Config = serde_json::from_reader(BufReader::new(file))?;
                config.dir_path = Some(current_dir.clone());

                // Load lock file
                let lock_path = current_dir.join(LOCK_FILENAME);
                let lock = if lock_path.is_file() {
                    let file = File::open(&lock_path)?;
                    serde_json::from_reader(BufReader::new(file))?
                } else {
                    LockFile::default()
                };

                return Ok((config, lock));
            }
            if !current_dir.pop() {
                bail!("Workspace has not been setup. Run 'workspace init' first.");
            }
        }
    }

    /// Get reference to config
    fn config(&self) -> &Config {
        &self.config
    }

    /// Get mutable reference to config
    fn config_mut(&mut self) -> &mut Config {
        &mut self.config
    }

    /// Get reference to lock file
    fn lock(&self) -> &LockFile {
        &self.lock
    }

    /// Get mutable reference to lock file
    fn lock_mut(&mut self) -> &mut LockFile {
        &mut self.lock
    }

    /// Get all members
    fn members(&self) -> &HashMap<String, String> {
        &self.lock.members
    }

    /// Get mutable reference to members
    fn members_mut(&mut self) -> &mut HashMap<String, String> {
        &mut self.lock.members
    }

    /// Disable auto-commit (for read-only operations)
    fn read_only(mut self) -> Self {
        self.should_commit = false;
        self
    }

    /// Manually commit (also happens automatically on drop if should_commit is true)
    fn commit(&self) -> Result<()> {
        let config_dir = self
            .config
            .dir_path
            .as_ref()
            .cloned()
            .or_else(|| std::env::current_dir().ok())
            .ok_or_else(|| anyhow!("Failed to determine config directory"))?;

        // Write JSON config
        let config_path = config_dir.join(CONFIG_FILENAME);
        let file = File::create(&config_path)
            .with_context(|| format!("Failed to create config file: {}", config_path.display()))?;
        serde_json::to_writer_pretty(file, &self.config).context("Failed to write config file")?;

        // Write lock file
        let lock_path = config_dir.join(LOCK_FILENAME);
        let file = File::create(&lock_path)
            .with_context(|| format!("Failed to create lock file: {}", lock_path.display()))?;
        serde_json::to_writer_pretty(file, &self.lock).context("Failed to write lock file")?;

        // Write Makefile
        // self.write_makefile(&config_dir)?;

        info!("Configuration committed to {}", config_dir.display());
        Ok(())
    }

    fn write_makefile(&self, config_dir: &Path) -> Result<()> {
        let make_path = config_dir.join(MAKE_FILENAME);
        let mut file = File::create(&make_path)
            .with_context(|| format!("Failed to create Makefile: {}", make_path.display()))?;

        writeln!(file)?;
        writeln!(file, "define tmux")?;
        writeln!(
            file,
            "\ttmux new-window -n $1 \"source ~/.extend.rc; $(subst $\\\",,$(2))\""
        )?;
        writeln!(file, "endef")?;
        writeln!(file)?;
        writeln!(file, "define kill")?;
        writeln!(file, "    tmux kill-window -t $(1) || true")?;
        writeln!(file, "endef")?;
        writeln!(file)?;

        for (member, path) in &self.lock.members {
            writeln!(file, "{} := {}", member, path)?;
        }

        file.flush()
            .with_context(|| format!("Failed to flush Makefile: {}", make_path.display()))?;

        Ok(())
    }
}

impl Drop for ConfigGuard {
    fn drop(&mut self) {
        if self.should_commit {
            if let Err(e) = self.commit() {
                error!("Failed to auto-commit configuration: {:#}", e);
            }
        }
    }
}

#[derive(Debug)]
struct JobResult {
    workflow: String,
    job: String,
    log_path: PathBuf,
    duration: std::time::Duration,
    error: Option<String>,
}

fn cmd_init(pattern: Option<String>) -> Result<()> {
    let resolver = if let Some(pat) = pattern {
        format!("fd -H '{}' * | xargs -I{{}} dirname {{}}", pat)
    } else {
        DEFAULT_RESOLVER.to_string()
    };

    let mut config = Config::default();
    config.resolver = resolver;

    let lock = LockFile::default();

    let config_dir = std::env::current_dir().context("Failed to get current directory")?;

    // Write initial files
    let config_path = config_dir.join(CONFIG_FILENAME);
    let file = File::create(&config_path)?;
    serde_json::to_writer_pretty(file, &config)?;

    let lock_path = config_dir.join(LOCK_FILENAME);
    let file = File::create(&lock_path)?;
    serde_json::to_writer_pretty(file, &lock)?;

    info!("Workspace initialized successfully");
    info!("Resolver: {}", config.resolver);

    // Immediately sync
    cmd_sync()
}

fn cmd_list(full: bool, output: &str) -> Result<()> {
    let guard = ConfigGuard::load()?.read_only();
    let members = guard.members();

    match output {
        "json" => {
            let json = serde_json::to_string_pretty(&members)?;
            println!("{}", json);
        }
        "paths" => {
            for path in members.values() {
                println!("{}", path);
            }
        }
        "table" | _ => {
            if members.is_empty() {
                info!("No workspace members found. Run 'workspace sync' to discover members.");
                return Ok(());
            }

            let mut member_list: Vec<_> = members.iter().collect();
            member_list.sort_by_key(|(name, _)| *name);

            let max_name_len = member_list.iter().map(|(n, _)| n.len()).max().unwrap_or(0);

            println!("\n{:width$}  Path", "Member", width = max_name_len);
            println!("{}", "─".repeat(max_name_len + 2 + 50));

            for (name, path) in member_list {
                if full {
                    println!("{:width$}  {}", name, path, width = max_name_len);
                } else {
                    let display_path = if let Ok(home) = std::env::var("HOME") {
                        path.replace(&home, "~")
                    } else {
                        path.clone()
                    };
                    println!("{:width$}  {}", name, display_path, width = max_name_len);
                }
            }
            println!();
        }
    }

    Ok(())
}

fn cmd_add(name: String, path: Option<PathBuf>) -> Result<()> {
    let mut guard = ConfigGuard::load_mut()?;

    let target_path = if let Some(p) = path {
        fs::canonicalize(&p).with_context(|| format!("Failed to resolve path: {}", p.display()))?
    } else {
        std::env::current_dir().context("Failed to get current directory")?
    };

    if guard.members().contains_key(&name) {
        warn!("Member '{}' already exists, updating path", name);
    }

    let path_str = target_path.to_string_lossy().to_string();
    guard.members_mut().insert(name.clone(), path_str.clone());

    info!("Added member '{}' -> {}", name, path_str);
    Ok(())
}

fn cmd_remove(name: String) -> Result<()> {
    let mut guard = ConfigGuard::load_mut()?;

    if guard.members_mut().remove(&name).is_some() {
        info!("Removed member '{}'", name);
    } else {
        bail!("Member '{}' not found in workspace", name);
    }

    Ok(())
}

fn cmd_edit() -> Result<()> {
    let guard = ConfigGuard::load()?.read_only();
    let config_dir = guard
        .config()
        .dir_path
        .as_ref()
        .ok_or_else(|| anyhow!("Could not determine config directory"))?;
    let config_path = config_dir.join(CONFIG_FILENAME);

    let editor = std::env::var("EDITOR")
        .or_else(|_| std::env::var("VISUAL"))
        .unwrap_or_else(|_| "vim".to_string());

    info!("Opening {} with {}", config_path.display(), editor);

    let status = Command::new(&editor)
        .arg(&config_path)
        .status()
        .with_context(|| format!("Failed to launch editor: {}", editor))?;

    if !status.success() {
        bail!("Editor exited with non-zero status");
    }

    // Validate the edited config
    match ConfigGuard::load() {
        Ok(_) => info!("Configuration is valid"),
        Err(e) => {
            error!("Configuration validation failed: {:#}", e);
            bail!("Invalid configuration after edit");
        }
    }

    Ok(())
}

fn cmd_validate(fix: bool) -> Result<()> {
    let mut guard = if fix {
        ConfigGuard::load_mut()?
    } else {
        ConfigGuard::load()?.read_only()
    };

    let mut issues = Vec::new();
    let mut fixed = Vec::new();

    // Check if resolver is empty
    if guard.config().resolver.is_empty() {
        issues.push("Resolver is empty".to_string());
        if fix {
            guard.config_mut().resolver = DEFAULT_RESOLVER.to_string();
            fixed.push("Set resolver to default".to_string());
        }
    }

    // Check if members have valid paths
    let mut invalid_members = Vec::new();
    for (name, path) in guard.members() {
        if !Path::new(path).exists() {
            issues.push(format!(
                "Member '{}' points to non-existent path: {}",
                name, path
            ));
            invalid_members.push(name.clone());
        }
    }

    if fix && !invalid_members.is_empty() {
        for name in &invalid_members {
            guard.members_mut().remove(name);
            fixed.push(format!("Removed member '{}' with invalid path", name));
        }
    }

    // Check for duplicate paths
    let mut path_counts: HashMap<String, Vec<String>> = HashMap::new();
    for (name, path) in guard.members() {
        path_counts
            .entry(path.clone())
            .or_insert_with(Vec::new)
            .push(name.clone());
    }

    for (path, names) in path_counts {
        if names.len() > 1 {
            issues.push(format!(
                "Duplicate path '{}' used by members: {}",
                path,
                names.join(", ")
            ));
        }
    }

    // Check workflows
    for (wf_name, jobs) in &guard.config().workflows {
        if jobs.is_empty() {
            issues.push(format!("Workflow '{}' has no jobs", wf_name));
        }

        for (job_name, script) in jobs {
            if script.trim().is_empty() {
                issues.push(format!("Job '{}.{}' has empty script", wf_name, job_name));
            }
        }
    }

    // Report results
    if issues.is_empty() {
        info!("✓ Configuration is valid!");
        return Ok(());
    }

    println!("\nValidation Issues:");
    for issue in &issues {
        println!("  ✗ {}", issue);
    }

    if fix {
        if !fixed.is_empty() {
            println!("\nFixed:");
            for fix_msg in &fixed {
                println!("  ✓ {}", fix_msg);
            }
            info!("Configuration updated with fixes");
        } else {
            warn!("No automatic fixes available for these issues");
        }
    } else {
        println!("\nRun with --fix to automatically resolve some issues");
    }

    if !fix || (fix && issues.len() > fixed.len()) {
        bail!("Configuration has {} issue(s)", issues.len());
    }

    Ok(())
}

fn cmd_info(name: String) -> Result<()> {
    let guard = ConfigGuard::load()?.read_only();

    let path = guard
        .members()
        .get(&name)
        .ok_or_else(|| anyhow!("Member '{}' not found", name))?;

    println!("\nMember: {}", name);
    println!("Path:   {}", path);

    let path_obj = Path::new(path);
    println!("Exists: {}", if path_obj.exists() { "yes" } else { "no" });

    if path_obj.exists() {
        if let Ok(metadata) = fs::metadata(path) {
            println!(
                "Type:   {}",
                if metadata.is_dir() {
                    "directory"
                } else {
                    "file"
                }
            );

            if let Ok(canonical) = fs::canonicalize(path) {
                println!("Canon:  {}", canonical.display());
            }
        }

        let git_dir = path_obj.join(".git");
        if git_dir.exists() {
            println!("Git:    yes");

            if let Ok(output) = Command::new("git")
                .current_dir(path)
                .args(&["rev-parse", "--abbrev-ref", "HEAD"])
                .output()
            {
                if output.status.success() {
                    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    println!("Branch: {}", branch);
                }
            }
        }
    }

    // Find workflows that reference this member
    let mut referencing_workflows = Vec::new();
    let member_ref = format!("{{{{.Members.{}}}}}", name);

    for (wf_name, jobs) in &guard.config().workflows {
        for (job_name, script) in jobs {
            if script.contains(&member_ref) {
                referencing_workflows.push(format!("{}.{}", wf_name, job_name));
            }
        }
    }

    if !referencing_workflows.is_empty() {
        println!("\nReferenced in workflows:");
        for wf in referencing_workflows {
            println!("  - {}", wf);
        }
    }

    println!();
    Ok(())
}

fn cmd_workflow(action: WorkflowAction) -> Result<()> {
    match action {
        WorkflowAction::List => {
            let guard = ConfigGuard::load()?.read_only();

            if guard.config().workflows.is_empty() {
                info!("No workflows defined");
                return Ok(());
            }

            println!("\nWorkflows:");
            for (name, jobs) in &guard.config().workflows {
                println!(
                    "  {} ({} job{})",
                    name,
                    jobs.len(),
                    if jobs.len() == 1 { "" } else { "s" }
                );
                for job_name in jobs.keys() {
                    println!("    - {}", job_name);
                }
            }
            println!();
        }

        WorkflowAction::Add { name } => {
            let mut guard = ConfigGuard::load_mut()?;

            if guard.config().workflows.contains_key(&name) {
                bail!("Workflow '{}' already exists", name);
            }

            guard
                .config_mut()
                .workflows
                .insert(name.clone(), HashMap::new());
            info!("Created workflow '{}'", name);
        }

        WorkflowAction::Remove { name } => {
            let mut guard = ConfigGuard::load_mut()?;

            if guard.config_mut().workflows.remove(&name).is_some() {
                info!("Removed workflow '{}'", name);
            } else {
                bail!("Workflow '{}' not found", name);
            }
        }

        WorkflowAction::AddJob {
            workflow,
            job,
            script,
        } => {
            let mut guard = ConfigGuard::load_mut()?;

            let jobs = guard
                .config_mut()
                .workflows
                .entry(workflow.clone())
                .or_insert_with(HashMap::new);

            if jobs.contains_key(&job) {
                warn!(
                    "Job '{}' already exists in workflow '{}', updating",
                    job, workflow
                );
            }

            jobs.insert(job.clone(), script.clone());
            info!("Added job '{}' to workflow '{}'", job, workflow);
        }

        WorkflowAction::RemoveJob { workflow, job } => {
            let mut guard = ConfigGuard::load_mut()?;

            let jobs = guard
                .config_mut()
                .workflows
                .get_mut(&workflow)
                .ok_or_else(|| anyhow!("Workflow '{}' not found", workflow))?;

            if jobs.remove(&job).is_some() {
                info!("Removed job '{}' from workflow '{}'", job, workflow);
            } else {
                bail!("Job '{}' not found in workflow '{}'", job, workflow);
            }
        }

        WorkflowAction::Show { name } => {
            let guard = ConfigGuard::load()?.read_only();

            let jobs = guard
                .config()
                .workflows
                .get(&name)
                .ok_or_else(|| anyhow!("Workflow '{}' not found", name))?;

            println!("\nWorkflow: {}", name);
            println!("Jobs: {}\n", jobs.len());

            for (job_name, script) in jobs {
                println!("  {}:", job_name);
                for line in script.lines() {
                    println!("    {}", line);
                }
                println!();
            }
        }
    }

    Ok(())
}

fn cmd_root() -> Result<()> {
    let guard = ConfigGuard::load()?.read_only();
    let root = guard
        .config()
        .dir_path
        .as_ref()
        .ok_or_else(|| anyhow!("Could not determine workspace root"))?;
    println!("{}", root.display());
    Ok(())
}

fn cmd_exec(
    command: String,
    args: Vec<String>,
    parallel: bool,
    members: Vec<String>,
) -> Result<()> {
    let guard = ConfigGuard::load()?.read_only();

    let target_members: Vec<_> = if members.is_empty() {
        guard.members().iter().collect()
    } else {
        members
            .iter()
            .map(|name| {
                guard
                    .members()
                    .get(name)
                    .map(|path| (name, path))
                    .ok_or_else(|| anyhow!("Member '{}' not found", name))
            })
            .collect::<Result<Vec<_>>>()?
    };

    if target_members.is_empty() {
        info!("No members to execute on");
        return Ok(());
    }

    let full_command = if args.is_empty() {
        command.clone()
    } else {
        format!("{} {}", command, args.join(" "))
    };

    info!(
        "Executing '{}' on {} member(s)",
        full_command,
        target_members.len()
    );

    if parallel {
        let (tx, rx) = mpsc::channel();

        for (name, path) in target_members {
            let name = (*name).clone();
            let path = path.clone();
            let cmd = command.clone();
            let args = args.clone();
            let tx = tx.clone();

            thread::spawn(move || {
                let result = execute_in_member(&name, &path, &cmd, &args);
                let _ = tx.send((name, result));
            });
        }

        drop(tx);

        for (name, result) in rx {
            match result {
                Ok(_) => info!("✓ {}: success", name),
                Err(e) => error!("✗ {}: {}", name, e),
            }
        }
    } else {
        for (name, path) in target_members {
            info!("Executing in '{}'...", name);
            match execute_in_member(name, path, &command, &args) {
                Ok(output) => {
                    if !output.is_empty() {
                        println!("{}", output);
                    }
                }
                Err(e) => error!("Failed in '{}': {}", name, e),
            }
        }
    }

    Ok(())
}

fn execute_in_member(name: &str, path: &str, command: &str, args: &[String]) -> Result<String> {
    let output = Command::new(command)
        .args(args)
        .current_dir(path)
        .output()
        .with_context(|| format!("Failed to execute command in '{}'", name))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("Command failed: {}", stderr.trim());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn cmd_stats() -> Result<()> {
    let guard = ConfigGuard::load()?.read_only();

    println!("\nWorkspace Statistics");
    println!("====================\n");

    println!("Members:   {}", guard.members().len());
    println!("Workflows: {}", guard.config().workflows.len());

    let total_jobs: usize = guard
        .config()
        .workflows
        .values()
        .map(|jobs| jobs.len())
        .sum();
    println!("Total Jobs: {}\n", total_jobs);

    println!("Members:");
    let mut existing = 0;
    let mut missing = 0;
    let mut git_repos = 0;

    for (_, path) in guard.members() {
        let path_obj = Path::new(path);
        if path_obj.exists() {
            existing += 1;
            if path_obj.join(".git").exists() {
                git_repos += 1;
            }
        } else {
            missing += 1;
        }
    }

    println!("  Existing:     {}", existing);
    println!("  Missing:      {}", missing);
    println!("  Git repos:    {}\n", git_repos);

    if !guard.config().workflows.is_empty() {
        println!("Workflows:");
        let mut workflow_stats: Vec<_> = guard
            .config()
            .workflows
            .iter()
            .map(|(name, jobs)| (name, jobs.len()))
            .collect();
        workflow_stats.sort_by_key(|(_, count)| std::cmp::Reverse(*count));

        for (name, count) in workflow_stats.iter().take(5) {
            println!(
                "  {:20} {} job{}",
                name,
                count,
                if *count == 1 { "" } else { "s" }
            );
        }

        if workflow_stats.len() > 5 {
            println!("  ... and {} more", workflow_stats.len() - 5);
        }
    }

    if let Some(root) = &guard.config().dir_path {
        println!("\nWorkspace root: {}", root.display());
    }

    println!();
    Ok(())
}

fn cmd_sync() -> Result<()> {
    let mut guard = ConfigGuard::load_mut()?;

    if let Some(dir_path) = &guard.config().dir_path {
        std::env::set_current_dir(dir_path).with_context(|| {
            format!(
                "Failed to change to workspace directory: {}",
                dir_path.display()
            )
        })?;
    }

    info!("Running resolver: {}", guard.config().resolver);

    let output = Command::new("sh")
        .arg("-c")
        .arg(&guard.config().resolver)
        .output()
        .context("Failed to execute resolver command")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("Resolver command failed: {}", stderr.trim());
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    guard.members_mut().clear();

    for line in output_str.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        match fs::canonicalize(line) {
            Ok(abs_path) => {
                if let Some(member_name) = abs_path.file_name() {
                    let member_name = member_name.to_string_lossy().to_string();
                    let path_str = abs_path.to_string_lossy().to_string();
                    guard.members_mut().insert(member_name, path_str);
                } else {
                    warn!(
                        "Could not extract member name from path: {}",
                        abs_path.display()
                    );
                }
            }
            Err(e) => {
                warn!("Failed to get absolute path for '{}': {}", line, e);
            }
        }
    }

    if let Some(dir_path) = guard.config().dir_path.clone() {
        guard
            .members_mut()
            .insert("root".to_string(), dir_path.to_string_lossy().to_string());
    }

    info!("Found {} workspace members", guard.members().len());

    // Manually commit before showing the list
    guard.commit()?;

    // Show the workspace list
    println!();
    let member_list: Vec<_> = guard.members().iter().collect();
    if !member_list.is_empty() {
        let mut sorted_members = member_list.clone();
        sorted_members.sort_by_key(|(name, _)| *name);

        let max_name_len = sorted_members
            .iter()
            .map(|(n, _)| n.len())
            .max()
            .unwrap_or(0);

        println!("{:width$}  Path", "Member", width = max_name_len);
        println!("{}", "─".repeat(max_name_len + 2 + 50));

        for (name, path) in sorted_members {
            let display_path = if let Ok(home) = std::env::var("HOME") {
                path.replace(&home, "~")
            } else {
                path.clone()
            };
            println!("{:width$}  {}", name, display_path, width = max_name_len);
        }
        println!();
    }

    Ok(())
}

fn cmd_config() -> Result<()> {
    let guard = ConfigGuard::load()?.read_only();

    let combined = serde_json::json!({
        "resolver": guard.config().resolver,
        "workflows": guard.config().workflows,
        "members": guard.members(),
    });

    let json = serde_json::to_string_pretty(&combined).context("Failed to serialize config")?;
    println!("{}", json);
    Ok(())
}

fn cmd_find(path: String) -> Result<()> {
    let guard = ConfigGuard::load()?.read_only();

    let search_path = fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path));
    let search_str = search_path.to_string_lossy();

    let mut matches: Vec<(String, String)> = guard
        .members()
        .iter()
        .filter(|(_, member_path)| search_str.contains(member_path.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    if matches.is_empty() {
        bail!(
            "Failed to find a related workspace member for path: {}",
            path
        );
    }

    matches.sort_by_key(|(_, path)| std::cmp::Reverse(path.len()));
    let (longest_member, longest_path) = &matches[0];

    let result = serde_json::json!({
        "member": longest_member,
        "path": longest_path,
    });

    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

fn cmd_run(workflow: String) -> Result<()> {
    let guard = ConfigGuard::load()?.read_only();

    let jobs = guard
        .config()
        .workflows
        .get(&workflow)
        .ok_or_else(|| anyhow!("Workflow '{}' does not exist", workflow))?;

    if jobs.is_empty() {
        info!("Workflow '{}' has no jobs to run", workflow);
        return Ok(());
    }

    let mut parsed_jobs = HashMap::new();

    for (name, script) in jobs {
        let interpolated =
            interpolate_template(script, guard.config(), guard.members(), &workflow, name)?;
        parsed_jobs.insert(name.clone(), interpolated);
    }

    info!(
        "Running workflow '{}' with {} job(s)",
        workflow,
        parsed_jobs.len()
    );

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
    let (tx, rx) = mpsc::channel();

    for (name, script) in parsed_jobs {
        let workflow = workflow.clone();
        let shell = shell.clone();
        let tx = tx.clone();

        thread::spawn(move || {
            let log_name = format!("{}.{}.log", workflow, name);
            let start = Instant::now();

            info!("Executing {}.{}: {}", workflow, name, script);

            let result = execute_job(&shell, &script, &log_name);
            let duration = start.elapsed();

            let job_result = JobResult {
                workflow: workflow.clone(),
                job: name.clone(),
                log_path: PathBuf::from(log_name),
                duration,
                error: result.err().map(|e| e.to_string()),
            };

            let _ = tx.send(job_result);
        });
    }

    drop(tx);

    let mut all_success = true;
    for result in rx {
        if let Some(error) = &result.error {
            error!(
                "Job {}.{} failed after {:.2}s: {}",
                result.workflow,
                result.job,
                result.duration.as_secs_f64(),
                error
            );
            all_success = false;
        } else {
            info!(
                "Job {}.{} completed successfully in {:.2}s (log: {})",
                result.workflow,
                result.job,
                result.duration.as_secs_f64(),
                result.log_path.display()
            );
        }
    }

    if !all_success {
        bail!("Some jobs in workflow '{}' failed", workflow);
    }

    Ok(())
}

fn interpolate_template(
    script: &str,
    config: &Config,
    members: &HashMap<String, String>,
    workflow: &str,
    job: &str,
) -> Result<String> {
    let mut current = script.to_string();
    let max_iterations = 10;

    for _ in 0..max_iterations {
        let mut result = current.clone();
        let mut changed = false;

        if result.contains("{{.Resolver}}") {
            result = result.replace("{{.Resolver}}", &config.resolver);
            changed = true;
        }

        for (member, path) in members {
            let pattern = format!("{{{{.Members.{}}}}}", member);
            if result.contains(&pattern) {
                result = result.replace(&pattern, path);
                changed = true;
            }
        }

        for (wf_name, wf_jobs) in &config.workflows {
            for (job_name, job_script) in wf_jobs {
                let pattern = format!("{{{{.Workflows.{}.{}}}}}", wf_name, job_name);
                if result.contains(&pattern) {
                    result = result.replace(&pattern, job_script);
                    changed = true;
                }
            }
        }

        if !changed {
            return Ok(result);
        }

        current = result;
    }

    bail!(
        "Template interpolation exceeded maximum iterations ({}) for {}.{}",
        max_iterations,
        workflow,
        job
    );
}

fn execute_job(shell: &str, script: &str, log_name: &str) -> Result<()> {
    let log_file = File::create(log_name)
        .with_context(|| format!("Failed to create log file: {}", log_name))?;

    let status = Command::new(shell)
        .arg("-c")
        .arg(script)
        .stdout(Stdio::from(log_file.try_clone()?))
        .stderr(Stdio::from(log_file))
        .status()
        .context("Failed to execute job command")?;

    if !status.success() {
        bail!("Job exited with status: {}", status);
    }

    Ok(())
}

fn cmd_link(from: Option<PathBuf>, to: Option<PathBuf>, real: bool, force: bool) -> Result<()> {
    let from = from
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| anyhow!("Could not determine source directory"))?;

    let to = to
        .or_else(|| dirs::home_dir())
        .ok_or_else(|| anyhow!("Could not determine target directory"))?;

    let from_abs = fs::canonicalize(&from)
        .with_context(|| format!("Failed to get absolute path for source: {}", from.display()))?;

    let to_abs = fs::canonicalize(&to)
        .or_else(|_| std::env::current_dir().map(|cwd| cwd.join(&to)))
        .with_context(|| format!("Failed to get absolute path for target: {}", to.display()))?;

    info!(
        "Linking from {} to {}",
        from_abs.display(),
        to_abs.display()
    );

    walkdir::WalkDir::new(&from_abs)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .try_for_each(|entry| -> Result<()> {
            let source_path = entry.path();

            let relative = source_path
                .strip_prefix(&from_abs)
                .context("Failed to strip prefix")?;

            let target_path = to_abs.join(relative);
            let target_dir = target_path
                .parent()
                .ok_or_else(|| anyhow!("Target path has no parent"))?;

            if !target_dir.exists() {
                fs::create_dir_all(target_dir).with_context(|| {
                    format!("Failed to create directory: {}", target_dir.display())
                })?;
            }

            if real {
                if target_path.exists() {
                    if !force {
                        bail!(
                            "{} already exists. Use --force to override",
                            target_path.display()
                        );
                    }

                    fs::remove_file(&target_path).with_context(|| {
                        format!("Failed to delete existing file: {}", target_path.display())
                    })?;
                }

                #[cfg(unix)]
                std::os::unix::fs::symlink(source_path, &target_path).with_context(|| {
                    format!("Failed to create symlink: {}", target_path.display())
                })?;

                #[cfg(windows)]
                std::os::windows::fs::symlink_file(source_path, &target_path).with_context(
                    || format!("Failed to create symlink: {}", target_path.display()),
                )?;

                info!(
                    "Linked {} -> {}",
                    source_path.display(),
                    target_path.display()
                );
            } else {
                info!(
                    "[DRY-RUN] Would link {} -> {}",
                    source_path.display(),
                    target_path.display()
                );
            }

            Ok(())
        })?;

    Ok(())
}

fn cmd_log(filters: Vec<String>) -> Result<()> {
    if filters.len() % 2 != 0 {
        bail!("Log filters must be provided as key-value pairs (even number of arguments)");
    }

    let mut filter_map: HashMap<String, Regex> = HashMap::new();
    for chunk in filters.chunks(2) {
        let key = chunk[0].clone();
        let pattern = Regex::new(&chunk[1])
            .with_context(|| format!("Invalid regex pattern for key '{}': {}", key, chunk[1]))?;
        filter_map.insert(key, pattern);
    }

    let stdin = io::stdin();
    let reader = BufReader::new(stdin.lock());
    let stdout = io::stdout();
    let mut writer = io::BufWriter::new(stdout.lock());

    for line in reader.lines() {
        let line = line.context("Failed to read line from stdin")?;

        if matches_filters(&line, &filter_map) {
            writeln!(writer, "{}", line).context("Failed to write to stdout")?;
        }
    }

    writer.flush().context("Failed to flush stdout")?;
    Ok(())
}

fn matches_filters(line: &str, filters: &HashMap<String, Regex>) -> bool {
    let parsed: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return false,
    };

    for (key, pattern) in filters {
        if !match_json_path(&parsed, key, pattern) {
            return false;
        }
    }

    true
}

fn match_json_path(value: &Value, path: &str, pattern: &Regex) -> bool {
    let keys: Vec<&str> = path.split('.').collect();
    let mut current = value;

    for key in keys {
        match current {
            Value::Object(map) => match map.get(key) {
                Some(v) => current = v,
                None => return false,
            },
            _ => return false,
        }
    }

    match current {
        Value::String(s) => pattern.is_match(s),
        Value::Number(n) => pattern.is_match(&n.to_string()),
        Value::Bool(b) => pattern.is_match(&b.to_string()),
        Value::Null => pattern.is_match("null"),
        _ => false,
    }
}

fn main() {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false)
        .finish();

    tracing::subscriber::set_global_default(subscriber).expect("Failed to set tracing subscriber");

    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Init { pattern } => cmd_init(pattern),
        Commands::Sync => cmd_sync(),
        Commands::Config => cmd_config(),
        Commands::Run { workflow } => cmd_run(workflow),
        Commands::Find { path } => cmd_find(path),
        Commands::Link {
            from,
            to,
            real,
            force,
        } => cmd_link(from, to, real, force),
        Commands::Log { filters } => cmd_log(filters),
        Commands::List { full, output } => cmd_list(full, &output),
        Commands::Add { name, path } => cmd_add(name, path),
        Commands::Remove { name } => cmd_remove(name),
        Commands::Edit => cmd_edit(),
        Commands::Validate { fix } => cmd_validate(fix),
        Commands::Info { name } => cmd_info(name),
        Commands::Workflow { action } => cmd_workflow(action),
        Commands::Root => cmd_root(),
        Commands::Exec {
            command,
            args,
            parallel,
            members,
        } => cmd_exec(command, args, parallel, members),
        Commands::Stats => cmd_stats(),
    };

    if let Err(e) = result {
        error!("{:#}", e);
        std::process::exit(1);
    }
}
