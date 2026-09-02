use anyhow::{Context, Result, anyhow, bail};
use clap::{Parser, Subcommand, ValueEnum};
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
use std::time::{Instant, SystemTime};
use tracing::{Level, error, info, warn};
use tracing_subscriber::FmtSubscriber;

const CONFIG_FILENAME: &str = "workspace.json";
const LOCK_FILENAME: &str = "workspace.lock.json";
const DEFAULT_RESOLVER: &str = "fd -H '^.git$' * | xargs -I{} dirname {}";
const MAKE_FILENAME: &str = "workspace.mk";

#[derive(Parser)]
#[command(name = "toolbox")]
#[command(about = "Personal developer toolbox", version, long_about = None)]
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
    #[command(alias = "r")]
    Review {
        /// Base branch to compare against (defaults to main)
        #[arg(short, long, default_value = "main")]
        base: String,
    },

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

        /// Apply changes (dry-run if false)
        #[arg(short, long, visible_alias = "real", default_value_t = false)]
        apply: bool,

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
    /// Runs a tui to play a lofi radio
    Radio,

    /// Launch Codex with deterministic development workflow profiles
    Agent {
        #[command(subcommand)]
        action: Option<AgentAction>,
    },

    /// Show workspace statistics
    Stats,
}

const AGENT_CONFIG_TOML: &str = include_str!("./agent.toml");

#[derive(Debug, Clone, Copy, ValueEnum)]
enum AgentProfileName {
    Default,
    Plan,
    Build,
    Review,
}

impl AgentProfileName {
    fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Plan => "plan",
            Self::Build => "build",
            Self::Review => "review",
        }
    }
}

#[derive(Subcommand)]
enum AgentAction {
    /// Start a fresh Sol/high planning session using $dev-plan
    Plan {
        /// Project request passed to $dev-plan
        prompt: Vec<String>,
    },

    /// Start a fresh Terra/medium build session for exactly one numbered plan
    Build {
        /// Exact plans/<project>/<NN>-*.md path
        plan: PathBuf,

        /// Optional extra instructions for this build only
        prompt: Vec<String>,
    },

    /// Start a fresh Sol/high independent review session
    Review {
        /// Commit to review
        #[arg(default_value = "HEAD")]
        commit: String,
    },

    /// Show Codex usage statistics from local rollout JSONL files
    Stats {
        /// Number of most recent sessions to show
        #[arg(long, default_value_t = 1, conflicts_with = "file")]
        last: usize,

        /// Analyze one explicit rollout JSONL file
        #[arg(long)]
        file: Option<PathBuf>,

        /// Emit machine-readable JSON
        #[arg(long)]
        json: bool,
    },

    /// Show the embedded overlay and effective Codex runtime overrides
    Config {
        /// Workflow profile to inspect
        #[arg(long, value_enum, default_value_t = AgentProfileName::Default)]
        profile: AgentProfileName,

        /// Print only the generated Codex arguments
        #[arg(long)]
        args: bool,
    },
}

#[derive(Debug, Deserialize, Default)]
struct AgentConfig {
    #[serde(default)]
    codex: toml::Table,
    #[serde(default)]
    profiles: HashMap<String, AgentProfileConfig>,
    #[serde(default)]
    stats: AgentStatsPolicy,
}

#[derive(Debug, Deserialize)]
struct AgentProfileConfig {
    model: String,
    model_reasoning_effort: String,
    #[serde(default)]
    skill: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(default)]
struct AgentStatsPolicy {
    warn_model_calls: u64,
    bad_model_calls: u64,
    warn_peak_input_tokens: u64,
    bad_peak_input_tokens: u64,
    warn_compactions: u64,
    bad_compactions: u64,
}

impl Default for AgentStatsPolicy {
    fn default() -> Self {
        Self {
            warn_model_calls: 80,
            bad_model_calls: 120,
            warn_peak_input_tokens: 100_000,
            bad_peak_input_tokens: 120_000,
            warn_compactions: 1,
            bad_compactions: 2,
        }
    }
}

#[derive(Debug, Serialize)]
struct AgentSessionStats {
    file: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    started_at: Option<String>,
    ended_at: Option<String>,
    input_tokens: u64,
    cached_input_tokens: u64,
    uncached_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
    model_calls: u64,
    tool_calls: u64,
    compactions: u64,
    median_input_tokens_per_call: u64,
    p90_input_tokens_per_call: u64,
    peak_input_tokens_per_call: u64,
    weekly_used_percent_start: Option<f64>,
    weekly_used_percent_end: Option<f64>,
    weekly_used_percent_delta: Option<f64>,
    assessment: Vec<String>,
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

fn cmd_review(base: String) -> Result<()> {
    let remote_output = Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .output()
        .context("Failed to get git remote URL. Are you inside a Git repository?")?;

    if !remote_output.status.success() {
        bail!("Git remote 'origin' not found.");
    }

    let remote_url = String::from_utf8_lossy(&remote_output.stdout)
        .trim()
        .to_string();

    let owner_repo =
        if let Some(cap) = Regex::new(r"github\.com[:/](.+?)(?:\.git)?$")?.captures(&remote_url) {
            cap.get(1).unwrap().as_str().to_string()
        } else {
            bail!("Could not parse GitHub repository from URL: {}", remote_url);
        };

    let branch_output = Command::new("git")
        .args(["branch", "--show-current"])
        .output()
        .context("Failed to get current git branch")?;

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();
    if branch.is_empty() {
        bail!("Not currently on a valid Git branch (detached HEAD?).");
    }

    // 4. Build compare URL
    let compare_url = format!(
        "https://github.com/{}/compare/{}...{}",
        owner_repo, base, branch
    );
    info!("Opening compare view: {}", compare_url);

    // 5. Open URL in default web browser
    #[cfg(target_os = "macos")]
    Command::new("open").arg(&compare_url).spawn()?;

    #[cfg(target_os = "linux")]
    Command::new("xdg-open").arg(&compare_url).spawn()?;

    #[cfg(target_os = "windows")]
    Command::new("cmd")
        .args(["/C", "start", &compare_url])
        .spawn()?;

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

fn path_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn remove_existing(path: &Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e).with_context(|| format!("Failed to inspect {}", path.display())),
    };

    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path)
            .with_context(|| format!("Failed to remove file: {}", path.display()))?;
    } else if metadata.is_dir() {
        fs::remove_dir_all(path)
            .with_context(|| format!("Failed to remove directory: {}", path.display()))?;
    }

    Ok(())
}

fn symlink_points_to(target: &Path, source: &Path) -> bool {
    let Ok(link) = fs::read_link(target) else {
        return false;
    };

    let resolved = if link.is_absolute() {
        link
    } else {
        target.parent().unwrap_or_else(|| Path::new(".")).join(link)
    };

    fs::canonicalize(resolved).ok().as_deref() == fs::canonicalize(source).ok().as_deref()
}

fn create_symlink(source: &Path, target: &Path, is_dir: bool) -> Result<()> {
    #[cfg(unix)]
    {
        let _ = is_dir;
        std::os::unix::fs::symlink(source, target)
            .with_context(|| format!("Failed to create symlink: {}", target.display()))?;
    }

    #[cfg(windows)]
    {
        if is_dir {
            std::os::windows::fs::symlink_dir(source, target).with_context(|| {
                format!("Failed to create directory symlink: {}", target.display())
            })?;
        } else {
            std::os::windows::fs::symlink_file(source, target)
                .with_context(|| format!("Failed to create file symlink: {}", target.display()))?;
        }
    }

    Ok(())
}

fn link_path(source: &Path, target: &Path, apply: bool, force: bool) -> Result<()> {
    let source_metadata = fs::symlink_metadata(source)
        .with_context(|| format!("Failed to inspect source: {}", source.display()))?;
    let atomic_dir = source_metadata.is_dir() && source.join(".link-dir").is_file();

    if source_metadata.is_dir() && !atomic_dir {
        if path_exists(target) {
            let target_metadata = fs::symlink_metadata(target)
                .with_context(|| format!("Failed to inspect target: {}", target.display()))?;

            if !target_metadata.is_dir() || target_metadata.file_type().is_symlink() {
                if !force {
                    bail!(
                        "{} already exists and is not a directory. Use --force to override",
                        target.display()
                    );
                }
                if apply {
                    remove_existing(target)?;
                    fs::create_dir_all(target).with_context(|| {
                        format!("Failed to create directory: {}", target.display())
                    })?;
                } else {
                    info!(
                        "[DRY-RUN] Would replace {} with a directory",
                        target.display()
                    );
                }
            }
        } else if apply {
            fs::create_dir_all(target)
                .with_context(|| format!("Failed to create directory: {}", target.display()))?;
        } else {
            info!("[DRY-RUN] Would create directory {}", target.display());
        }

        let mut entries = fs::read_dir(source)
            .with_context(|| format!("Failed to read directory: {}", source.display()))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            link_path(&entry.path(), &target.join(entry.file_name()), apply, force)?;
        }
        return Ok(());
    }

    if path_exists(target) {
        if symlink_points_to(target, source) {
            info!(
                "Already linked {} -> {}",
                source.display(),
                target.display()
            );
            return Ok(());
        }

        if !force {
            bail!(
                "{} already exists. Use --force to override",
                target.display()
            );
        }

        if apply {
            remove_existing(target)?;
        } else {
            info!("[DRY-RUN] Would replace {}", target.display());
        }
    }

    if apply {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create directory: {}", parent.display()))?;
        }
        create_symlink(source, target, source_metadata.is_dir())?;
        info!("Linked {} -> {}", source.display(), target.display());
    } else {
        info!(
            "[DRY-RUN] Would link {} -> {}",
            source.display(),
            target.display()
        );
    }

    Ok(())
}

fn cmd_link(from: Option<PathBuf>, to: Option<PathBuf>, apply: bool, force: bool) -> Result<()> {
    let from = from
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| anyhow!("Could not determine source directory"))?;

    let to = to
        .or_else(|| dirs::home_dir())
        .ok_or_else(|| anyhow!("Could not determine target directory"))?;

    let from_abs = fs::canonicalize(&from)
        .with_context(|| format!("Failed to get absolute path for source: {}", from.display()))?;

    let to_abs = if to.is_absolute() {
        to
    } else {
        std::env::current_dir()
            .context("Failed to get current directory")?
            .join(to)
    };

    info!(
        "Linking from {} to {}{}",
        from_abs.display(),
        to_abs.display(),
        if apply { "" } else { " (dry-run)" }
    );

    link_path(&from_abs, &to_abs, apply, force)
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

fn load_agent_config() -> Result<AgentConfig> {
    toml::from_str::<AgentConfig>(AGENT_CONFIG_TOML).context("Failed to parse embedded agent.toml")
}

fn toml_scalar(value: &toml::Value) -> Result<String> {
    match value {
        toml::Value::String(value) => Ok(format!("{:?}", value)),
        toml::Value::Integer(value) => Ok(value.to_string()),
        toml::Value::Float(value) => Ok(value.to_string()),
        toml::Value::Boolean(value) => Ok(value.to_string()),
        toml::Value::Datetime(value) => Ok(format!("{:?}", value.to_string())),
        toml::Value::Array(_) | toml::Value::Table(_) => {
            bail!("Codex overlay leaves must be scalar TOML values")
        }
    }
}

fn flatten_codex_table(
    prefix: &str,
    table: &toml::Table,
    output: &mut Vec<(String, String)>,
) -> Result<()> {
    let mut entries: Vec<_> = table.iter().collect();
    entries.sort_by_key(|(key, _)| *key);

    for (key, value) in entries {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{}.{}", prefix, key)
        };

        match value {
            toml::Value::Table(child) => flatten_codex_table(&path, child, output)?,
            value => output.push((path, toml_scalar(value)?)),
        }
    }

    Ok(())
}

fn agent_profile<'a>(
    config: &'a AgentConfig,
    profile: AgentProfileName,
) -> Result<&'a AgentProfileConfig> {
    config.profiles.get(profile.as_str()).ok_or_else(|| {
        anyhow!(
            "Embedded agent config is missing profile '{}'",
            profile.as_str()
        )
    })
}

fn agent_codex_overrides(
    config: &AgentConfig,
    profile: AgentProfileName,
) -> Result<Vec<(String, String)>> {
    let mut overrides = Vec::new();
    flatten_codex_table("", &config.codex, &mut overrides)?;

    let profile = agent_profile(config, profile)?;
    overrides.push(("model".to_string(), format!("{:?}", profile.model)));
    overrides.push((
        "model_reasoning_effort".to_string(),
        format!("{:?}", profile.model_reasoning_effort),
    ));

    Ok(overrides)
}

fn agent_codex_args(config: &AgentConfig, profile: AgentProfileName) -> Result<Vec<String>> {
    let mut args = Vec::new();
    for (key, value) in agent_codex_overrides(config, profile)? {
        args.push("-c".to_string());
        args.push(format!("{key}={value}"));
    }
    Ok(args)
}

fn agent_workflow_prompt(
    config: &AgentConfig,
    profile: AgentProfileName,
    body: &str,
) -> Result<String> {
    let profile_config = agent_profile(config, profile)?;
    let skill = profile_config.skill.as_deref().ok_or_else(|| {
        anyhow!(
            "Embedded agent profile '{}' does not define a skill",
            profile.as_str()
        )
    })?;

    if body.trim().is_empty() {
        Ok(format!("${skill}"))
    } else {
        Ok(format!("${skill} {}", body.trim()))
    }
}

fn validate_build_plan(plan: &Path) -> Result<PathBuf> {
    if plan.extension().and_then(|ext| ext.to_str()) != Some("md") {
        bail!("Build plan must be a markdown file: {}", plan.display());
    }
    if !plan.is_file() {
        bail!("Build plan does not exist: {}", plan.display());
    }

    let components: Vec<_> = plan.components().collect();
    if !components
        .iter()
        .any(|component| component.as_os_str() == "plans")
    {
        bail!(
            "Build requires an exact plans/<project>/<NN>-*.md path: {}",
            plan.display()
        );
    }

    let file_name = plan
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("Build plan filename is not valid UTF-8"))?;
    let bytes = file_name.as_bytes();
    if bytes.len() < 4
        || !bytes[0].is_ascii_digit()
        || !bytes[1].is_ascii_digit()
        || bytes[2] != b'-'
    {
        bail!(
            "Build plan filename must start with a two-digit plan number, e.g. 01-foo.md: {}",
            file_name
        );
    }

    Ok(plan.to_path_buf())
}

fn exec_codex(profile: AgentProfileName, prompt: Option<String>) -> Result<()> {
    let config = load_agent_config()?;
    let args = agent_codex_args(&config, profile)?;

    let mut command = Command::new("codex");
    command.args(&args);
    if let Some(prompt) = prompt {
        command.arg(prompt);
    }

    info!(
        "Starting fresh Codex session with '{}' profile",
        profile.as_str()
    );

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let error = command.exec();
        Err(error).context("Failed to exec codex")
    }

    #[cfg(not(unix))]
    {
        let status = command.status().context("Failed to launch codex")?;
        if !status.success() {
            bail!("codex exited with status {status}");
        }
        Ok(())
    }
}

fn cmd_agent(action: Option<AgentAction>) -> Result<()> {
    match action {
        None => exec_codex(AgentProfileName::Default, None),
        Some(AgentAction::Plan { prompt }) => {
            let config = load_agent_config()?;
            let body = prompt.join(" ");
            let prompt = agent_workflow_prompt(&config, AgentProfileName::Plan, &body)?;
            exec_codex(AgentProfileName::Plan, Some(prompt))
        }
        Some(AgentAction::Build { plan, prompt }) => {
            let plan = validate_build_plan(&plan)?;
            let config = load_agent_config()?;
            let mut body = plan.display().to_string();
            if !prompt.is_empty() {
                body.push(' ');
                body.push_str(&prompt.join(" "));
            }
            let prompt = agent_workflow_prompt(&config, AgentProfileName::Build, &body)?;
            exec_codex(AgentProfileName::Build, Some(prompt))
        }
        Some(AgentAction::Review { commit }) => {
            let config = load_agent_config()?;
            let prompt = agent_workflow_prompt(&config, AgentProfileName::Review, &commit)?;
            exec_codex(AgentProfileName::Review, Some(prompt))
        }
        Some(AgentAction::Stats { last, file, json }) => cmd_agent_stats(last, file, json),
        Some(AgentAction::Config { profile, args }) => cmd_agent_config(profile, args),
    }
}

fn cmd_agent_config(profile: AgentProfileName, args_only: bool) -> Result<()> {
    let config = load_agent_config()?;
    let args = agent_codex_args(&config, profile)?;

    if args_only {
        println!("{}", args.join(" "));
        return Ok(());
    }

    println!("Embedded agent overlay:\n");
    println!("{AGENT_CONFIG_TOML}");
    println!("Effective workflow profile: {}\n", profile.as_str());
    println!("Codex runtime overrides:");
    for pair in args.chunks_exact(2) {
        println!("  {} {}", pair[0], pair[1]);
    }
    Ok(())
}

fn codex_home() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("CODEX_HOME") {
        return Ok(PathBuf::from(path));
    }
    dirs::home_dir()
        .map(|home| home.join(".codex"))
        .ok_or_else(|| anyhow!("Could not determine CODEX_HOME or home directory"))
}

fn collect_rollout_files(dir: &Path, output: &mut Vec<PathBuf>) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir)
        .with_context(|| format!("Failed to read Codex sessions directory: {}", dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_rollout_files(&path, output)?;
        } else if file_type.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
        {
            output.push(path);
        }
    }
    Ok(())
}

fn modified_time(path: &Path) -> SystemTime {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn recent_rollout_files(last: usize) -> Result<Vec<PathBuf>> {
    if last == 0 {
        bail!("--last must be at least 1");
    }

    let sessions = codex_home()?.join("sessions");
    let mut files = Vec::new();
    collect_rollout_files(&sessions, &mut files)?;
    files.sort_by_key(|path| std::cmp::Reverse(modified_time(path)));
    files.truncate(last);

    if files.is_empty() {
        bail!(
            "No Codex rollout JSONL files found under {}",
            sessions.display()
        );
    }
    Ok(files)
}

fn json_u64(value: &Value, path: &[&str]) -> Option<u64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_u64()
}

fn json_f64(value: &Value, path: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_f64()
}

fn json_str(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(ToOwned::to_owned)
}

fn percentile(sorted: &[u64], numerator: usize, denominator: usize) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let index = ((sorted.len() - 1) * numerator + denominator - 1) / denominator;
    sorted[index.min(sorted.len() - 1)]
}

fn analyze_rollout(path: &Path, policy: &AgentStatsPolicy) -> Result<AgentSessionStats> {
    let file = File::open(path)
        .with_context(|| format!("Failed to open Codex rollout: {}", path.display()))?;
    let reader = BufReader::new(file);

    let mut model = None;
    let mut reasoning_effort = None;
    let mut started_at = None;
    let mut ended_at = None;
    let mut totals = (0_u64, 0_u64, 0_u64, 0_u64);
    let mut model_calls = 0_u64;
    let mut tool_calls = 0_u64;
    let mut compactions = 0_u64;
    let mut call_inputs = Vec::new();
    let mut quota_start = None;
    let mut quota_end = None;

    for (line_number, line) in reader.lines().enumerate() {
        let line = line.with_context(|| {
            format!(
                "Failed reading {} at line {}",
                path.display(),
                line_number + 1
            )
        })?;
        let value: Value = serde_json::from_str(&line).with_context(|| {
            format!(
                "Invalid JSON in {} at line {}",
                path.display(),
                line_number + 1
            )
        })?;

        if started_at.is_none() {
            started_at = json_str(&value, &["timestamp"]);
        }
        if let Some(timestamp) = json_str(&value, &["timestamp"]) {
            ended_at = Some(timestamp);
        }

        match value.get("type").and_then(Value::as_str) {
            Some("session_meta") => {
                model = model.or_else(|| {
                    json_str(
                        &value,
                        &["payload", "base_instructions", "provenance", "model"],
                    )
                });
            }
            Some("turn_context") => {
                model = json_str(&value, &["payload", "model"]).or(model);
                reasoning_effort = json_str(&value, &["payload", "effort"]).or(reasoning_effort);
            }
            Some("compacted") => compactions += 1,
            Some("response_item") => {
                if json_str(&value, &["payload", "type"]).as_deref() == Some("custom_tool_call") {
                    tool_calls += 1;
                }
            }
            Some("event_msg") => {
                if json_str(&value, &["payload", "type"]).as_deref() == Some("token_count") {
                    model_calls += 1;
                    if let Some(input) = json_u64(
                        &value,
                        &["payload", "info", "last_token_usage", "input_tokens"],
                    ) {
                        call_inputs.push(input);
                    }

                    let total = &["payload", "info", "total_token_usage"];
                    totals.0 = json_u64(&value, &[total[0], total[1], total[2], "input_tokens"])
                        .unwrap_or(totals.0);
                    totals.1 = json_u64(
                        &value,
                        &[total[0], total[1], total[2], "cached_input_tokens"],
                    )
                    .unwrap_or(totals.1);
                    totals.2 = json_u64(&value, &[total[0], total[1], total[2], "output_tokens"])
                        .unwrap_or(totals.2);
                    totals.3 = json_u64(
                        &value,
                        &[total[0], total[1], total[2], "reasoning_output_tokens"],
                    )
                    .unwrap_or(totals.3);

                    if let Some(percent) = json_f64(
                        &value,
                        &["payload", "rate_limits", "primary", "used_percent"],
                    ) {
                        quota_start.get_or_insert(percent);
                        quota_end = Some(percent);
                    }
                }
            }
            _ => {}
        }
    }

    call_inputs.sort_unstable();
    let median = percentile(&call_inputs, 1, 2);
    let p90 = percentile(&call_inputs, 9, 10);
    let peak = call_inputs.last().copied().unwrap_or(0);
    let uncached = totals.0.saturating_sub(totals.1);
    let quota_delta = quota_start.zip(quota_end).map(|(start, end)| end - start);

    let mut assessment = Vec::new();
    if model_calls > policy.bad_model_calls {
        assessment.push(format!(
            "BAD: {model_calls} model calls > {}",
            policy.bad_model_calls
        ));
    } else if model_calls > policy.warn_model_calls {
        assessment.push(format!(
            "WARN: {model_calls} model calls > {}",
            policy.warn_model_calls
        ));
    } else {
        assessment.push(format!("OK: {model_calls} model calls"));
    }

    if peak >= policy.bad_peak_input_tokens {
        assessment.push(format!(
            "BAD: peak input {peak} >= {} tokens",
            policy.bad_peak_input_tokens
        ));
    } else if peak >= policy.warn_peak_input_tokens {
        assessment.push(format!(
            "WARN: peak input {peak} >= {} tokens",
            policy.warn_peak_input_tokens
        ));
    } else {
        assessment.push(format!("OK: peak input {peak} tokens"));
    }

    if compactions >= policy.bad_compactions {
        assessment.push(format!(
            "BAD: {compactions} compactions >= {}",
            policy.bad_compactions
        ));
    } else if compactions >= policy.warn_compactions {
        assessment.push(format!(
            "WARN: {compactions} compactions >= {}",
            policy.warn_compactions
        ));
    } else {
        assessment.push(format!("OK: {compactions} compactions"));
    }

    Ok(AgentSessionStats {
        file: path.display().to_string(),
        model,
        reasoning_effort,
        started_at,
        ended_at,
        input_tokens: totals.0,
        cached_input_tokens: totals.1,
        uncached_input_tokens: uncached,
        output_tokens: totals.2,
        reasoning_output_tokens: totals.3,
        model_calls,
        tool_calls,
        compactions,
        median_input_tokens_per_call: median,
        p90_input_tokens_per_call: p90,
        peak_input_tokens_per_call: peak,
        weekly_used_percent_start: quota_start,
        weekly_used_percent_end: quota_end,
        weekly_used_percent_delta: quota_delta,
        assessment,
    })
}

fn format_tokens(value: u64) -> String {
    if value >= 1_000_000 {
        format!("{:.2}M", value as f64 / 1_000_000.0)
    } else if value >= 1_000 {
        format!("{:.1}K", value as f64 / 1_000.0)
    } else {
        value.to_string()
    }
}

fn print_agent_stats(stats: &AgentSessionStats) {
    println!("Codex session");
    println!("────────────────────────────────────────");
    println!(
        "Model              {}{}",
        stats.model.as_deref().unwrap_or("unknown"),
        stats
            .reasoning_effort
            .as_deref()
            .map(|effort| format!(" / {effort}"))
            .unwrap_or_default()
    );
    println!("File               {}", stats.file);
    if let Some(started) = &stats.started_at {
        println!("Started            {started}");
    }
    if let Some(ended) = &stats.ended_at {
        println!("Ended              {ended}");
    }
    println!();
    println!("Usage");
    println!("Input              {}", format_tokens(stats.input_tokens));
    println!(
        "  cached           {}",
        format_tokens(stats.cached_input_tokens)
    );
    println!(
        "  uncached         {}",
        format_tokens(stats.uncached_input_tokens)
    );
    println!("Output             {}", format_tokens(stats.output_tokens));
    println!(
        "Reasoning          {}",
        format_tokens(stats.reasoning_output_tokens)
    );
    println!();
    println!("Agent loop");
    println!("Model calls        {}", stats.model_calls);
    println!("Tool calls         {}", stats.tool_calls);
    println!("Compactions        {}", stats.compactions);
    println!();
    println!("Input / model call");
    println!(
        "Median             {}",
        format_tokens(stats.median_input_tokens_per_call)
    );
    println!(
        "P90                {}",
        format_tokens(stats.p90_input_tokens_per_call)
    );
    println!(
        "Peak               {}",
        format_tokens(stats.peak_input_tokens_per_call)
    );

    if let (Some(start), Some(end)) = (
        stats.weekly_used_percent_start,
        stats.weekly_used_percent_end,
    ) {
        println!();
        println!("Weekly quota       {start:.1}% → {end:.1}%");
        if let Some(delta) = stats.weekly_used_percent_delta {
            println!("Delta              {delta:+.1}%");
        }
    }

    println!();
    println!("Assessment");
    for item in &stats.assessment {
        println!("  {item}");
    }
}

fn cmd_agent_stats(last: usize, file: Option<PathBuf>, json: bool) -> Result<()> {
    let config = load_agent_config()?;
    let files = if let Some(file) = file {
        if !file.is_file() {
            bail!("Rollout file does not exist: {}", file.display());
        }
        vec![file]
    } else {
        recent_rollout_files(last)?
    };

    let stats = files
        .iter()
        .map(|path| analyze_rollout(path, &config.stats))
        .collect::<Result<Vec<_>>>()?;

    if json {
        println!("{}", serde_json::to_string_pretty(&stats)?);
        return Ok(());
    }

    for (index, session) in stats.iter().enumerate() {
        if index > 0 {
            println!("\n");
        }
        print_agent_stats(session);
    }
    Ok(())
}

fn run_shell(program: &str) -> Result<()> {
    Command::new(program)
        .status()
        .map(|_| ())
        .context("run_shell failed")
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
        Commands::Review { base } => cmd_review(base),
        Commands::Run { workflow } => cmd_run(workflow),
        Commands::Find { path } => cmd_find(path),
        Commands::Link {
            from,
            to,
            apply,
            force,
        } => cmd_link(from, to, apply, force),
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
        Commands::Radio => run_shell("cliamp"),
        Commands::Agent { action } => cmd_agent(action),
        Commands::Stats => cmd_stats(),
    };

    if let Err(e) = result {
        error!("{:#}", e);
        std::process::exit(1);
    }
}
