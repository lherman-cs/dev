use anyhow::{Context, Result, anyhow, bail};
use clap::{Parser, Subcommand, ValueEnum};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read, Write};
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

    /// Reconcile files from one directory into another using regular copies
    Reconcile {
        /// Source directory (defaults to current directory)
        #[arg(short, long)]
        from: Option<PathBuf>,

        /// Target directory (defaults to home directory)
        #[arg(short, long)]
        to: Option<PathBuf>,

        /// Apply changes (dry-run if false)
        #[arg(short, long, visible_alias = "real", default_value_t = false)]
        apply: bool,
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

    /// Launch Codex with toolbox-owned model profiles
    #[command(alias = "a")]
    Agent {
        #[command(subcommand)]
        action: Option<AgentAction>,
    },

    /// Show workspace statistics
    Stats,
}

const AGENT_CONFIG_TOML: &str = include_str!("../agent.toml");

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
    /// Start a fresh Sol/high planning session
    #[command(alias = "p")]
    Plan {
        /// Optional initial Codex prompt
        prompt: Vec<String>,
    },

    /// Start a fresh Terra/medium build session
    #[command(alias = "b")]
    Build {
        /// Optional initial Codex prompt
        prompt: Vec<String>,
    },

    /// Start a fresh Sol/high review session
    #[command(alias = "r")]
    Review {
        /// Optional initial Codex prompt
        prompt: Vec<String>,
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

    /// Print a compact Codex transcript from local rollout JSONL files

    #[command(alias = "t")]
    Transcript {
        /// Number of most recent sessions to show

        #[arg(long, default_value_t = 1, conflicts_with = "file")]
        last: usize,

        /// Read one explicit rollout JSONL file

        #[arg(long)]
        file: Option<PathBuf>,

        /// Maximum characters kept for each tool input/output; 0 means unlimited

        #[arg(long, default_value_t = 4_000)]
        max_tool_chars: usize,

        /// Emit machine-readable JSON

        #[arg(long)]
        json: bool,
    },

    /// Show the embedded overlay and effective Codex runtime overrides
    Config {
        /// Profile to inspect
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

#[derive(Debug, Clone)]
struct RolloutIdentity {
    file: PathBuf,
    thread_id: String,
    parent_thread_id: Option<String>,
    forked_from_id: Option<String>,
    source_kind: String,
    agent_path: Option<String>,
    agent_nickname: Option<String>,
    agent_role: Option<String>,
    started_at: Option<String>,
    cwd: Option<String>,
    repository_url: Option<String>,
    git_branch: Option<String>,
    git_commit: Option<String>,
    subagent_history_start_ordinal: Option<u64>,
    modified: SystemTime,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
struct TokenUsage {
    input_tokens: u64,
    cached_input_tokens: u64,
    cache_write_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
    total_tokens: u64,
}

impl TokenUsage {
    fn from_json(value: &Value) -> Self {
        let get = |key: &str| value.get(key).and_then(Value::as_u64).unwrap_or(0);
        Self {
            input_tokens: get("input_tokens"),
            cached_input_tokens: get("cached_input_tokens"),
            cache_write_input_tokens: get("cache_write_input_tokens"),
            output_tokens: get("output_tokens"),
            reasoning_output_tokens: get("reasoning_output_tokens"),
            total_tokens: get("total_tokens"),
        }
    }

    fn delta_from(self, previous: Option<Self>) -> Self {
        let Some(previous) = previous else {
            return self;
        };

        // Codex total_token_usage is cumulative for a thread. Repeated token_count
        // events may carry the same cumulative snapshot; those must contribute zero.
        if self.total_tokens == previous.total_tokens
            && self.input_tokens == previous.input_tokens
            && self.output_tokens == previous.output_tokens
        {
            return Self::default();
        }

        // A lower cumulative total means the counter reset. Treat the new snapshot
        // as a fresh counter rather than subtracting across the reset.
        if self.total_tokens < previous.total_tokens
            || self.input_tokens < previous.input_tokens
            || self.output_tokens < previous.output_tokens
        {
            return self;
        }

        Self {
            input_tokens: self.input_tokens.saturating_sub(previous.input_tokens),
            cached_input_tokens: self
                .cached_input_tokens
                .saturating_sub(previous.cached_input_tokens),
            cache_write_input_tokens: self
                .cache_write_input_tokens
                .saturating_sub(previous.cache_write_input_tokens),
            output_tokens: self.output_tokens.saturating_sub(previous.output_tokens),
            reasoning_output_tokens: self
                .reasoning_output_tokens
                .saturating_sub(previous.reasoning_output_tokens),
            total_tokens: self.total_tokens.saturating_sub(previous.total_tokens),
        }
    }

    fn is_zero(self) -> bool {
        self.total_tokens == 0
            && self.input_tokens == 0
            && self.output_tokens == 0
            && self.cached_input_tokens == 0
            && self.cache_write_input_tokens == 0
            && self.reasoning_output_tokens == 0
    }

    fn add_assign(&mut self, other: Self) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.cached_input_tokens = self
            .cached_input_tokens
            .saturating_add(other.cached_input_tokens);
        self.cache_write_input_tokens = self
            .cache_write_input_tokens
            .saturating_add(other.cache_write_input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.reasoning_output_tokens = self
            .reasoning_output_tokens
            .saturating_add(other.reasoning_output_tokens);
        self.total_tokens = self.total_tokens.saturating_add(other.total_tokens);
    }
}

#[derive(Debug, Serialize, Default, Clone)]
struct AgentModelStats {
    threads: u64,
    input_tokens: u64,
    cached_input_tokens: u64,
    cache_write_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
    model_calls: u64,
    tool_calls: u64,
}

impl AgentModelStats {
    fn add_usage(&mut self, usage: TokenUsage) {
        self.input_tokens = self.input_tokens.saturating_add(usage.input_tokens);
        self.cached_input_tokens = self
            .cached_input_tokens
            .saturating_add(usage.cached_input_tokens);
        self.cache_write_input_tokens = self
            .cache_write_input_tokens
            .saturating_add(usage.cache_write_input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(usage.output_tokens);
        self.reasoning_output_tokens = self
            .reasoning_output_tokens
            .saturating_add(usage.reasoning_output_tokens);
    }
}

#[derive(Debug, Serialize, Clone)]
struct ObservedCommit {
    hash: String,
    subject: String,
    files_changed: Option<u64>,
    insertions: Option<u64>,
    deletions: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
struct AgentThreadStats {
    thread_id: String,
    parent_thread_id: Option<String>,
    source_kind: String,
    agent_path: Option<String>,
    agent_nickname: Option<String>,
    agent_role: Option<String>,
    file: String,
    cwd: Option<String>,
    repository_url: Option<String>,
    git_branch: Option<String>,
    git_commit_start: Option<String>,
    first_user_request: Option<String>,
    skills: Vec<String>,
    referenced_plans: Vec<String>,
    command_families: HashMap<String, u64>,
    commits: Vec<ObservedCommit>,
    task_completions: u64,
    final_result: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    started_at: Option<String>,
    ended_at: Option<String>,
    input_tokens: u64,
    cached_input_tokens: u64,
    cache_write_input_tokens: u64,
    uncached_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
    model_calls: u64,
    tool_calls: u64,
    compactions: u64,
    inherited_records_skipped: u64,
    median_input_tokens_per_call: u64,
    p90_input_tokens_per_call: u64,
    peak_input_tokens_per_call: u64,
    account_weekly_used_percent_first: Option<f64>,
    account_weekly_used_percent_last: Option<f64>,
    by_model: HashMap<String, AgentModelStats>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
struct AgentWorkflowStats {
    root_thread_id: String,
    root_file: String,
    root_source: String,
    cwd: Option<String>,
    repository_url: Option<String>,
    git_branch: Option<String>,
    git_commit_start: Option<String>,
    first_user_request: Option<String>,
    skills: Vec<String>,
    referenced_plans: Vec<String>,
    command_families: HashMap<String, u64>,
    commits: Vec<ObservedCommit>,
    task_completions: u64,
    final_result: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    started_at: Option<String>,
    ended_at: Option<String>,
    threads: usize,
    spawned_threads: usize,
    review_threads: usize,
    compact_threads: usize,
    input_tokens: u64,
    cached_input_tokens: u64,
    cache_write_input_tokens: u64,
    uncached_input_tokens: u64,
    output_tokens: u64,
    reasoning_output_tokens: u64,
    model_calls: u64,
    tool_calls: u64,
    compactions: u64,
    inherited_records_skipped: u64,
    median_input_tokens_per_call: u64,
    p90_input_tokens_per_call: u64,
    peak_input_tokens_per_call: u64,
    calls_over_100k: u64,
    calls_over_120k: u64,
    calls_over_200k: u64,
    cached_input_percent: f64,
    replay_amplification: Option<f64>,
    account_weekly_used_percent_first: Option<f64>,
    account_weekly_used_percent_last: Option<f64>,
    by_model: HashMap<String, AgentModelStats>,
    thread_details: Vec<AgentThreadStats>,
    warnings: Vec<String>,
    assessment: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]

struct AgentTranscriptEvent {
    timestamp: Option<String>,

    thread_id: String,

    source_kind: String,

    model: Option<String>,

    kind: String,

    tool: Option<String>,

    text: String,

    sequence: u64,
}

#[derive(Debug, Serialize)]

struct AgentWorkflowTranscript {
    root_thread_id: String,

    cwd: Option<String>,

    repository_url: Option<String>,

    git_branch: Option<String>,

    git_commit_start: Option<String>,

    threads: usize,

    events: Vec<AgentTranscriptEvent>,
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

fn files_equal(source: &Path, target: &Path) -> Result<bool> {
    let source_metadata = fs::metadata(source)
        .with_context(|| format!("Failed to inspect source file: {}", source.display()))?;
    let target_metadata = match fs::metadata(target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(error)
                .with_context(|| format!("Failed to inspect target file: {}", target.display()));
        }
    };

    if !target_metadata.is_file() || source_metadata.len() != target_metadata.len() {
        return Ok(false);
    }

    let mut source = BufReader::new(
        File::open(source).with_context(|| format!("Failed to open {}", source.display()))?,
    );
    let mut target = BufReader::new(
        File::open(target).with_context(|| format!("Failed to open {}", target.display()))?,
    );
    let mut source_buf = [0_u8; 16 * 1024];
    let mut target_buf = [0_u8; 16 * 1024];

    loop {
        let source_read = source.read(&mut source_buf)?;
        let target_read = target.read(&mut target_buf)?;
        if source_read != target_read {
            return Ok(false);
        }
        if source_read == 0 {
            return Ok(true);
        }
        if source_buf[..source_read] != target_buf[..target_read] {
            return Ok(false);
        }
    }
}

fn reconcile_path(source: &Path, target: &Path, apply: bool) -> Result<()> {
    let source_metadata = fs::symlink_metadata(source)
        .with_context(|| format!("Failed to inspect source: {}", source.display()))?;

    if source_metadata.is_dir() {
        if path_exists(target) {
            let target_metadata = fs::symlink_metadata(target)
                .with_context(|| format!("Failed to inspect target: {}", target.display()))?;
            if !target_metadata.is_dir() || target_metadata.file_type().is_symlink() {
                if apply {
                    remove_existing(target)?;
                    fs::create_dir_all(target).with_context(|| {
                        format!("Failed to create directory: {}", target.display())
                    })?;
                    info!("Replaced {} with a copied directory", target.display());
                } else {
                    info!(
                        "[DRY-RUN] Would replace {} with a copied directory",
                        target.display()
                    );
                }
            }
        } else if apply {
            fs::create_dir_all(target)
                .with_context(|| format!("Failed to create directory: {}", target.display()))?;
            info!("Created directory {}", target.display());
        } else {
            info!("[DRY-RUN] Would create directory {}", target.display());
        }

        let mut entries = fs::read_dir(source)
            .with_context(|| format!("Failed to read directory: {}", source.display()))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            // Legacy marker from the old symlink-based deployment. Ignore it so
            // `reconcile` can migrate repositories before the marker is deleted.
            if entry.file_name() == ".link-dir" {
                continue;
            }
            reconcile_path(&entry.path(), &target.join(entry.file_name()), apply)?;
        }
        return Ok(());
    }

    if source_metadata.file_type().is_symlink() {
        bail!(
            "Source symlinks are not supported by reconcile: {}",
            source.display()
        );
    }

    if path_exists(target) {
        let target_metadata = fs::symlink_metadata(target)
            .with_context(|| format!("Failed to inspect target: {}", target.display()))?;

        if !target_metadata.file_type().is_symlink()
            && target_metadata.is_file()
            && files_equal(source, target)?
        {
            return Ok(());
        }

        if apply {
            // This intentionally removes legacy symlinks as well as stale copied
            // files. The source tree is authoritative for paths it contains.
            remove_existing(target)?;
        } else {
            info!(
                "[DRY-RUN] Would replace {} with a copied file",
                target.display()
            );
        }
    }

    if apply {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create directory: {}", parent.display()))?;
        }
        fs::copy(source, target).with_context(|| {
            format!(
                "Failed to copy {} to {}",
                source.display(),
                target.display()
            )
        })?;
        info!("Copied {} -> {}", source.display(), target.display());
    } else if !path_exists(target) {
        info!(
            "[DRY-RUN] Would copy {} -> {}",
            source.display(),
            target.display()
        );
    }

    Ok(())
}

fn cmd_reconcile(from: Option<PathBuf>, to: Option<PathBuf>, apply: bool) -> Result<()> {
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
        "Reconciling copies from {} to {}{}",
        from_abs.display(),
        to_abs.display(),
        if apply { "" } else { " (dry-run)" }
    );

    reconcile_path(&from_abs, &to_abs, apply)
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

fn exec_codex(profile: AgentProfileName, prompt: Vec<String>) -> Result<()> {
    let config = load_agent_config()?;
    let args = agent_codex_args(&config, profile)?;

    let mut command = Command::new("codex");
    command.args(&args);
    if !prompt.is_empty() {
        let skill = match profile {
            AgentProfileName::Plan => Some("$dev-plan"),
            AgentProfileName::Build => Some("$dev-build"),
            AgentProfileName::Review => Some("$dev-review"),
            _ => None,
        };
        let prompt = prompt.join(" ");

        command.arg(match skill {
            Some(skill) => format!("{skill} {prompt}"),
            None => prompt,
        });
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
        None => exec_codex(AgentProfileName::Default, Vec::new()),
        Some(AgentAction::Plan { prompt }) => exec_codex(AgentProfileName::Plan, prompt),
        Some(AgentAction::Build { prompt }) => exec_codex(AgentProfileName::Build, prompt),
        Some(AgentAction::Review { prompt }) => exec_codex(AgentProfileName::Review, prompt),
        Some(AgentAction::Stats { last, file, json }) => cmd_agent_stats(last, file, json),
        Some(AgentAction::Config { profile, args }) => cmd_agent_config(profile, args),
        Some(AgentAction::Transcript {
            last,
            file,
            max_tool_chars,
            json,
        }) => cmd_agent_transcript(last, file, max_tool_chars, json),
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
    println!("Effective profile: {}\n", profile.as_str());
    println!("Codex runtime overrides:");
    for pair in args.chunks_exact(2) {
        println!("  {} {}", pair[0], pair[1]);
    }
    Ok(())
}

fn transcript_message_text(payload: &Value, role: &str) -> Option<String> {
    if payload.get("role").and_then(Value::as_str) != Some(role) {
        return None;
    }

    if role == "user" {
        // Codex also persists injected AGENTS/environment/skill material as

        // user-role messages. Keep only records explicitly marked as user.text

        // when that metadata is present.

        if let Some(kinds) = payload
            .get("internal_chat_message_metadata_passthrough")
            .and_then(|m| m.get("content_item_kinds"))
            .and_then(Value::as_array)
        {
            if !kinds.iter().any(|v| v.as_str() == Some("user.text")) {
                return None;
            }
        }
    }

    let content = payload.get("content")?.as_array()?;

    let mut parts = Vec::new();

    for item in content {
        let kind = item.get("type").and_then(Value::as_str).unwrap_or("");

        if matches!(kind, "input_text" | "output_text" | "text") {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                parts.push(text);
            }
        }
    }

    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn truncate_transcript_tool_text(value: String, max_chars: usize) -> String {
    if max_chars == 0 || value.chars().count() <= max_chars {
        return value;
    }

    let omitted = value.chars().count().saturating_sub(max_chars);

    let mut out = value.chars().take(max_chars).collect::<String>();

    out.push_str(&format!("\n… <{omitted} chars omitted>"));

    out
}

fn transcript_value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),

        Value::Array(items) => {
            let mut parts = Vec::new();

            for item in items {
                if let Some(text) = item.as_str() {
                    parts.push(text.to_owned());

                    continue;
                }

                if let Some(text) = item
                    .get("text")
                    .or_else(|| item.get("output_text"))
                    .and_then(Value::as_str)
                {
                    parts.push(text.to_owned());

                    continue;
                }

                let kind = item.get("type").and_then(Value::as_str).unwrap_or("");

                if kind.contains("image") {
                    parts.push("<image omitted>".to_string());
                }
            }

            if parts.is_empty() {
                serde_json::to_string_pretty(value).ok()
            } else {
                Some(parts.join("\n"))
            }
        }

        Value::Null => None,

        other => serde_json::to_string_pretty(other).ok(),
    }
}

fn transcript_tool_call(payload: &Value) -> Option<(Option<String>, String, Option<String>)> {
    if !looks_like_tool_call(payload) {
        return None;
    }

    let tool = payload
        .get("name")
        .or_else(|| payload.get("tool_name"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            payload
                .get("type")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        });

    let input = payload
        .get("arguments")
        .or_else(|| payload.get("input"))
        .or_else(|| payload.get("command"))
        .and_then(transcript_value_text)
        .unwrap_or_else(|| "<no tool input recorded>".to_string());

    let call_id = payload
        .get("call_id")
        .or_else(|| payload.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    Some((tool, input, call_id))
}

fn transcript_tool_output(
    payload: &Value,

    tool_names: &HashMap<String, String>,
) -> Option<(Option<String>, String)> {
    let kind = payload.get("type").and_then(Value::as_str)?;

    if !kind.ends_with("_call_output") && !kind.ends_with("_search_output") && kind != "tool_output"
    {
        return None;
    }

    let call_id = payload
        .get("call_id")
        .or_else(|| payload.get("id"))
        .and_then(Value::as_str);

    let tool = call_id
        .and_then(|id| tool_names.get(id))
        .cloned()
        .or_else(|| {
            payload
                .get("name")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        });

    let output = payload
        .get("output")
        .or_else(|| payload.get("content"))
        .and_then(transcript_value_text)
        .unwrap_or_else(|| "<no tool output recorded>".to_string());

    Some((tool, output))
}

fn transcript_event(
    identity: &RolloutIdentity,

    timestamp: Option<String>,

    active_model: &Option<String>,

    kind: &str,

    tool: Option<String>,

    text: String,

    sequence: u64,
) -> AgentTranscriptEvent {
    AgentTranscriptEvent {
        timestamp,

        thread_id: identity.thread_id.clone(),

        source_kind: identity.source_kind.clone(),

        model: active_model.clone(),

        kind: kind.to_string(),

        tool,

        text,

        sequence,
    }
}

fn read_transcript_events(
    identity: &RolloutIdentity,

    max_tool_chars: usize,
) -> Result<Vec<AgentTranscriptEvent>> {
    let file = File::open(&identity.file)
        .with_context(|| format!("Failed to open Codex rollout: {}", identity.file.display()))?;

    let reader = BufReader::new(file);

    let mut events = Vec::new();

    let mut active_model = None;

    let mut tool_names: HashMap<String, String> = HashMap::new();

    let mut sequence = 0_u64;

    for (line_number, line) in reader.lines().enumerate() {
        let line = line.with_context(|| {
            format!(
                "Failed reading {} at line {}",
                identity.file.display(),
                line_number + 1
            )
        })?;

        let line = line.trim_start_matches('\u{feff}');

        let value: Value = serde_json::from_str(line).with_context(|| {
            format!(
                "Invalid JSON in {} at line {}",
                identity.file.display(),
                line_number + 1
            )
        })?;

        let top_type = value.get("type").and_then(Value::as_str);

        if top_type != Some("session_meta") && rollout_line_is_inherited(identity, &value) {
            continue;
        }

        let timestamp = value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);

        match top_type {
            Some("session_meta") => {
                let payload = value.get("payload").unwrap_or(&Value::Null);

                let meta = session_meta_object(payload);

                if active_model.is_none() {
                    active_model = meta
                        .get("base_instructions")
                        .and_then(|base| base.get("provenance"))
                        .and_then(|prov| prov.get("model"))
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                }
            }

            Some("turn_context") => {
                if let Some(model) = json_str(&value, &["payload", "model"]) {
                    active_model = Some(model);
                }
            }

            Some("world_state") => {
                if let Some(model) = json_str(&value, &["payload", "state", "model"]) {
                    active_model = Some(model);
                }
            }

            Some("response_item") => {
                let payload = value.get("payload").unwrap_or(&Value::Null);

                if let Some(message) = transcript_message_text(payload, "user") {
                    sequence += 1;

                    events.push(transcript_event(
                        identity,
                        timestamp.clone(),
                        &active_model,
                        "user",
                        None,
                        message,
                        sequence,
                    ));

                    continue;
                }

                if let Some(message) = transcript_message_text(payload, "assistant") {
                    sequence += 1;

                    events.push(transcript_event(
                        identity,
                        timestamp.clone(),
                        &active_model,
                        "assistant",
                        None,
                        message,
                        sequence,
                    ));

                    continue;
                }

                if let Some((tool, input, call_id)) = transcript_tool_call(payload) {
                    if let (Some(call_id), Some(tool)) = (&call_id, &tool) {
                        tool_names.insert(call_id.clone(), tool.clone());
                    }

                    sequence += 1;

                    events.push(transcript_event(
                        identity,
                        timestamp.clone(),
                        &active_model,
                        "tool_call",
                        tool,
                        truncate_transcript_tool_text(input, max_tool_chars),
                        sequence,
                    ));

                    continue;
                }

                if let Some((tool, output)) = transcript_tool_output(payload, &tool_names) {
                    sequence += 1;

                    events.push(transcript_event(
                        identity,
                        timestamp,
                        &active_model,
                        "tool_output",
                        tool,
                        truncate_transcript_tool_text(output, max_tool_chars),
                        sequence,
                    ));

                    continue;
                }

                if payload
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| {
                        matches!(
                            kind,
                            "compaction" | "compaction_trigger" | "context_compaction"
                        )
                    })
                {
                    sequence += 1;

                    events.push(transcript_event(
                        identity,
                        timestamp,
                        &active_model,
                        "compaction",
                        None,
                        "<context compacted>".to_string(),
                        sequence,
                    ));
                }
            }

            Some("event_msg") => {
                let payload_type = json_str(&value, &["payload", "type"]);

                if payload_type.as_deref() == Some("thread_settings_applied") {
                    if let Some(model) = json_str(&value, &["payload", "thread_settings", "model"])
                    {
                        active_model = Some(model);
                    }
                } else if payload_type
                    .as_deref()
                    .is_some_and(|kind| kind == "compacted" || kind == "compact")
                {
                    sequence += 1;

                    events.push(transcript_event(
                        identity,
                        timestamp,
                        &active_model,
                        "compaction",
                        None,
                        "<context compacted>".to_string(),
                        sequence,
                    ));
                }
            }

            Some("compacted") => {
                sequence += 1;

                events.push(transcript_event(
                    identity,
                    timestamp,
                    &active_model,
                    "compaction",
                    None,
                    "<context compacted>".to_string(),
                    sequence,
                ));
            }

            _ => {}
        }
    }

    Ok(events)
}

fn build_workflow_transcript(
    index: &HashMap<String, RolloutIdentity>,

    root_thread_id: &str,

    max_tool_chars: usize,
) -> Result<AgentWorkflowTranscript> {
    let ids = workflow_thread_ids(index, root_thread_id);

    let root = index
        .get(root_thread_id)
        .ok_or_else(|| anyhow!("Missing root rollout identity for thread {root_thread_id}"))?;

    let mut events = Vec::new();

    for id in &ids {
        let identity = index
            .get(id)
            .ok_or_else(|| anyhow!("Missing rollout identity for thread {id}"))?;

        events.extend(read_transcript_events(identity, max_tool_chars)?);
    }

    events.sort_by(|a, b| {
        a.timestamp
            .cmp(&b.timestamp)
            .then_with(|| a.thread_id.cmp(&b.thread_id))
            .then_with(|| a.sequence.cmp(&b.sequence))
    });

    Ok(AgentWorkflowTranscript {
        root_thread_id: root_thread_id.to_owned(),

        cwd: root.cwd.clone(),

        repository_url: root.repository_url.clone(),

        git_branch: root.git_branch.clone(),

        git_commit_start: root.git_commit.clone(),

        threads: ids.len(),

        events,
    })
}

fn print_agent_transcript(transcript: &AgentWorkflowTranscript) {
    println!("Codex transcript");

    println!("────────────────────────────────────────────────────────");

    if let Some(cwd) = &transcript.cwd {
        println!("Workspace          {cwd}");
    }

    if let Some(branch) = &transcript.git_branch {
        let commit = transcript.git_commit_start.as_deref().unwrap_or("unknown");

        println!(
            "Git start          {branch} @ {}",
            truncate_one_line(commit, 12)
        );
    }

    if let Some(repo) = &transcript.repository_url {
        println!("Repository         {repo}");
    }

    println!("Session            {}", transcript.root_thread_id);

    println!("Threads            {}", transcript.threads);

    println!();

    for event in &transcript.events {
        let timestamp = event.timestamp.as_deref().unwrap_or("unknown-time");

        let thread_suffix = if transcript.threads > 1 {
            format!(" · {} · {}", event.source_kind, event.thread_id)
        } else {
            String::new()
        };

        let model_suffix = event
            .model
            .as_deref()
            .filter(|_| matches!(event.kind.as_str(), "assistant" | "tool_call"))
            .map(|model| format!(" · {model}"))
            .unwrap_or_default();

        let tool_suffix = event
            .tool
            .as_deref()
            .map(|tool| format!(" · {tool}"))
            .unwrap_or_default();

        println!(
            "[{timestamp}] {}{tool_suffix}{model_suffix}{thread_suffix}",
            event.kind
        );

        println!("{}", event.text);

        println!();
    }
}

fn cmd_agent_transcript(
    last: usize,

    file: Option<PathBuf>,

    max_tool_chars: usize,

    json: bool,
) -> Result<()> {
    let index = rollout_index()?;

    let root_ids = if let Some(file) = file {
        if !file.is_file() {
            bail!("Rollout file does not exist: {}", file.display());
        }

        let identity = read_rollout_identity(&file)?;

        let root = root_thread_id(&index, &identity.thread_id);

        vec![root]
    } else {
        recent_root_thread_ids(&index, last)?
    };

    let transcripts = root_ids
        .iter()
        .map(|root| build_workflow_transcript(&index, root, max_tool_chars))
        .collect::<Result<Vec<_>>>()?;

    if json {
        println!("{}", serde_json::to_string_pretty(&transcripts)?);

        return Ok(());
    }

    for (position, transcript) in transcripts.iter().enumerate() {
        if position > 0 {
            println!("\n");
        }

        print_agent_transcript(transcript);
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
        .with_context(|| format!("Failed to read Codex rollout directory: {}", dir.display()))?
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

fn session_meta_object(payload: &Value) -> &Value {
    payload.get("meta").unwrap_or(payload)
}

fn source_kind(meta: &Value) -> String {
    let Some(source) = meta.get("source") else {
        return "unknown".to_string();
    };

    if let Some(source) = source.as_str() {
        return source.to_string();
    }

    let Some(subagent) = source
        .get("subAgent")
        .or_else(|| source.get("sub_agent"))
        .or_else(|| source.get("subagent"))
    else {
        if let Some(custom) = source.get("custom").and_then(Value::as_str) {
            return format!("custom:{custom}");
        }
        return "unknown".to_string();
    };

    if let Some(kind) = subagent.as_str() {
        return format!("subagent:{kind}");
    }
    if subagent.get("thread_spawn").is_some() || subagent.get("threadSpawn").is_some() {
        return "subagent:thread_spawn".to_string();
    }
    if let Some(other) = subagent.get("other").and_then(Value::as_str) {
        return format!("subagent:{other}");
    }
    "subagent:unknown".to_string()
}

fn subagent_parent_from_source(meta: &Value) -> Option<String> {
    let source = meta.get("source")?;
    let subagent = source
        .get("subAgent")
        .or_else(|| source.get("sub_agent"))
        .or_else(|| source.get("subagent"))?;
    let spawn = subagent
        .get("thread_spawn")
        .or_else(|| subagent.get("threadSpawn"))?;
    spawn
        .get("parent_thread_id")
        .or_else(|| spawn.get("parentThreadId"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn read_rollout_identity(path: &Path) -> Result<RolloutIdentity> {
    let file = File::open(path)
        .with_context(|| format!("Failed to open Codex rollout: {}", path.display()))?;
    let reader = BufReader::new(file);

    for (line_number, line) in reader.lines().take(64).enumerate() {
        let line = line.with_context(|| {
            format!(
                "Failed reading {} at line {}",
                path.display(),
                line_number + 1
            )
        })?;
        let line = line.trim_start_matches('\u{feff}');
        let value: Value = serde_json::from_str(line).with_context(|| {
            format!(
                "Invalid JSON in {} at line {}",
                path.display(),
                line_number + 1
            )
        })?;
        if value.get("type").and_then(Value::as_str) != Some("session_meta") {
            continue;
        }

        let payload = value
            .get("payload")
            .ok_or_else(|| anyhow!("session_meta has no payload in {}", path.display()))?;
        let meta = session_meta_object(payload);
        // Codex 0.153+ subagent rollouts can carry the parent's id in
        // `session_id` while `id` is the actual child thread id. Prefer `id`
        // or the child can overwrite its parent in the rollout index.
        let thread_id = meta
            .get("id")
            .or_else(|| meta.get("thread_id"))
            .or_else(|| meta.get("session_id"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| anyhow!("session_meta has no thread id in {}", path.display()))?;

        let kind = source_kind(meta);
        let agent_path = meta
            .get("agent_path")
            .or_else(|| meta.get("agentPath"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let agent_nickname = meta
            .get("agent_nickname")
            .or_else(|| meta.get("agentNickname"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let agent_role = meta
            .get("agent_role")
            .or_else(|| meta.get("agentRole"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let direct_parent = meta
            .get("parent_thread_id")
            .or_else(|| meta.get("parentThreadId"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let forked_from_id = meta
            .get("forked_from_id")
            .or_else(|| meta.get("forkedFromId"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);

        let parent_thread_id = direct_parent
            .or_else(|| subagent_parent_from_source(meta))
            .or_else(|| {
                // Legacy subagent rollouts can identify only the fork parent.
                kind.starts_with("subagent:")
                    .then(|| forked_from_id.clone())
                    .flatten()
            })
            .filter(|parent| parent != &thread_id);

        let started_at = meta
            .get("timestamp")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| {
                value
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            });

        let cwd = meta
            .get("cwd")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);

        let git = meta.get("git");
        let repository_url = git
            .and_then(|git| git.get("repository_url"))
            .or_else(|| git.and_then(|git| git.get("repositoryUrl")))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let git_branch = git
            .and_then(|git| git.get("branch"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let git_commit = git
            .and_then(|git| git.get("commit_hash"))
            .or_else(|| git.and_then(|git| git.get("commitHash")))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);

        let subagent_history_start_ordinal = meta
            .get("subagent_history_start_ordinal")
            .or_else(|| meta.get("subagentHistoryStartOrdinal"))
            .and_then(Value::as_u64);

        return Ok(RolloutIdentity {
            file: path.to_path_buf(),
            thread_id,
            parent_thread_id,
            forked_from_id,
            source_kind: kind,
            agent_path,
            agent_nickname,
            agent_role,
            started_at,
            cwd,
            repository_url,
            git_branch,
            git_commit,
            subagent_history_start_ordinal,
            modified: modified_time(path),
        });
    }

    bail!("No session_meta found near start of {}", path.display())
}

fn spawned_child_ids_from_rollout(identity: &RolloutIdentity) -> Result<HashSet<String>> {
    let file = File::open(&identity.file)
        .with_context(|| format!("Failed to open Codex rollout: {}", identity.file.display()))?;
    let reader = BufReader::new(file);
    let mut children = HashSet::new();

    for (line_number, line) in reader.lines().enumerate() {
        let line = line.with_context(|| {
            format!(
                "Failed reading {} at line {}",
                identity.file.display(),
                line_number + 1
            )
        })?;
        let line = line.trim_start_matches('\u{feff}');
        let value: Value = serde_json::from_str(line).with_context(|| {
            format!(
                "Invalid JSON in {} at line {}",
                identity.file.display(),
                line_number + 1
            )
        })?;

        if value.get("type").and_then(Value::as_str) != Some("event_msg") {
            continue;
        }

        let payload = value.get("payload").unwrap_or(&Value::Null);
        match payload.get("type").and_then(Value::as_str) {
            // Multi-Agent V2 canonical parent-side topology signal.
            Some("sub_agent_activity")
                if payload.get("kind").and_then(Value::as_str) == Some("started") =>
            {
                if let Some(child) = payload
                    .get("agent_thread_id")
                    .or_else(|| payload.get("agentThreadId"))
                    .and_then(Value::as_str)
                {
                    children.insert(child.to_owned());
                }
            }

            // V1 / compatibility spawn completion carries the resolved child id.
            Some("collab_agent_spawn_end") => {
                if let Some(child) = payload
                    .get("new_thread_id")
                    .or_else(|| payload.get("newThreadId"))
                    .and_then(Value::as_str)
                {
                    children.insert(child.to_owned());
                }
            }

            _ => {}
        }
    }

    Ok(children)
}

fn rollout_index() -> Result<HashMap<String, RolloutIdentity>> {
    let home = codex_home()?;
    let mut files = Vec::new();
    collect_rollout_files(&home.join("sessions"), &mut files)?;
    collect_rollout_files(&home.join("archived_sessions"), &mut files)?;

    let mut index = HashMap::new();
    for path in files {
        match read_rollout_identity(&path) {
            Ok(identity) => {
                let replace = index
                    .get(&identity.thread_id)
                    .map(|old: &RolloutIdentity| identity.modified > old.modified)
                    .unwrap_or(true);
                if replace {
                    index.insert(identity.thread_id.clone(), identity);
                }
            }
            Err(error) => warn!(
                "Skipping unreadable Codex rollout {}: {error:#}",
                path.display()
            ),
        }
    }

    if index.is_empty() {
        bail!(
            "No readable Codex rollout JSONL files found under {}",
            home.display()
        );
    }

    // session_meta.parent_thread_id is useful, but Multi-Agent V2 also persists
    // authoritative parent-side SubAgentActivity records. Reconcile from those
    // records so sibling fan-out is not lost when child metadata is incomplete,
    // stale, or represented differently across Codex versions.
    let parents = index
        .values()
        .map(|identity| (identity.thread_id.clone(), identity.clone()))
        .collect::<Vec<_>>();
    let mut parent_edges = Vec::new();

    for (parent_id, identity) in parents {
        match spawned_child_ids_from_rollout(&identity) {
            Ok(children) => {
                for child_id in children {
                    if child_id != parent_id {
                        parent_edges.push((parent_id.clone(), child_id));
                    }
                }
            }
            Err(error) => warn!(
                "Could not recover subagent topology from {}: {error:#}",
                identity.file.display()
            ),
        }
    }

    for (parent_id, child_id) in parent_edges {
        if let Some(child) = index.get_mut(&child_id) {
            child.parent_thread_id = Some(parent_id);
        }
    }

    Ok(index)
}

fn root_thread_id(index: &HashMap<String, RolloutIdentity>, thread_id: &str) -> String {
    let mut current = thread_id.to_owned();
    let mut seen = HashSet::new();

    while seen.insert(current.clone()) {
        let Some(identity) = index.get(&current) else {
            break;
        };
        let Some(parent) = identity.parent_thread_id.as_deref() else {
            break;
        };
        if !index.contains_key(parent) {
            break;
        }
        current = parent.to_owned();
    }
    current
}

fn workflow_thread_ids(index: &HashMap<String, RolloutIdentity>, root: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut queue = vec![root.to_owned()];
    let mut seen = HashSet::new();

    while let Some(thread_id) = queue.pop() {
        if !seen.insert(thread_id.clone()) {
            continue;
        }
        result.push(thread_id.clone());

        for identity in index.values() {
            if identity.parent_thread_id.as_deref() == Some(thread_id.as_str()) {
                queue.push(identity.thread_id.clone());
            }
        }
    }

    result
}

fn recent_root_thread_ids(
    index: &HashMap<String, RolloutIdentity>,
    last: usize,
) -> Result<Vec<String>> {
    if last == 0 {
        bail!("--last must be at least 1");
    }

    let mut roots: Vec<_> = index
        .values()
        .filter(|identity| {
            identity
                .parent_thread_id
                .as_deref()
                .is_none_or(|parent| !index.contains_key(parent))
        })
        .collect();

    // "Last" means most recently created root workflows, not whichever old
    // workflow happened to receive a late file write.
    roots.sort_by(|a, b| {
        b.started_at
            .cmp(&a.started_at)
            .then_with(|| b.modified.cmp(&a.modified))
    });
    roots.truncate(last);

    if roots.is_empty() {
        bail!("No root Codex workflows found");
    }

    Ok(roots
        .into_iter()
        .map(|identity| identity.thread_id.clone())
        .collect())
}

fn json_str(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().map(ToOwned::to_owned)
}

fn json_f64(value: &Value, path: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_f64()
}

fn percentile(sorted: &[u64], numerator: usize, denominator: usize) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let rank = (sorted.len() * numerator).div_ceil(denominator);
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

fn is_auxiliary_model(model: &str) -> bool {
    model.starts_with("codex-auto-review")
        || model.contains("auto-review")
        || model.contains("auto_review")
}

fn set_main_model(target: &mut Option<String>, candidate: Option<String>) {
    let Some(candidate) = candidate else {
        return;
    };
    if is_auxiliary_model(&candidate) {
        return;
    }
    if target.is_none() {
        *target = Some(candidate);
    }
}

fn looks_like_tool_call(payload: &Value) -> bool {
    let Some(kind) = payload.get("type").and_then(Value::as_str) else {
        return false;
    };
    matches!(
        kind,
        "custom_tool_call"
            | "function_call"
            | "local_shell_call"
            | "web_search_call"
            | "computer_call"
            | "mcp_tool_call"
            | "tool_call"
    ) || (kind.ends_with("_call") && !kind.contains("output"))
}

fn rollout_line_is_inherited(identity: &RolloutIdentity, value: &Value) -> bool {
    let Some(boundary) = identity.subagent_history_start_ordinal else {
        return false;
    };
    let Some(ordinal) = value.get("ordinal").and_then(Value::as_u64) else {
        return false;
    };
    ordinal < boundary
}

fn truncate_one_line(value: &str, max_chars: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    let mut out = normalized
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    out.push('…');
    out
}

fn extract_user_text(payload: &Value) -> Option<String> {
    if payload.get("role").and_then(Value::as_str) != Some("user") {
        return None;
    }

    // Codex represents injected AGENTS/environment/skill material as user-role
    // messages too. Prefer records explicitly marked as real user text.
    if let Some(kinds) = payload
        .get("internal_chat_message_metadata_passthrough")
        .and_then(|m| m.get("content_item_kinds"))
        .and_then(Value::as_array)
    {
        let is_real_user = kinds.iter().any(|v| v.as_str() == Some("user.text"));
        if !is_real_user {
            return None;
        }
    }

    let content = payload.get("content")?.as_array()?;
    let mut parts = Vec::new();
    for item in content {
        let kind = item.get("type").and_then(Value::as_str).unwrap_or("");
        if matches!(kind, "input_text" | "text") {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                parts.push(text);
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

fn extract_skill_names(value: &Value, output: &mut HashSet<String>) {
    fn walk(value: &Value, output: &mut HashSet<String>) {
        match value {
            Value::Object(map) => {
                if map.get("type").and_then(Value::as_str) == Some("skill") {
                    if let Some(name) = map.get("name").and_then(Value::as_str) {
                        output.insert(name.to_owned());
                    }
                }
                for child in map.values() {
                    walk(child, output);
                }
            }
            Value::Array(items) => {
                for child in items {
                    walk(child, output);
                }
            }
            _ => {}
        }
    }
    walk(value, output);
}

fn extract_plan_paths(text: &str, output: &mut HashSet<String>) {
    if let Ok(re) = Regex::new(r"plans/[A-Za-z0-9._/-]+\.md") {
        for m in re.find_iter(text) {
            output.insert(m.as_str().to_owned());
        }
    }
}

fn command_family_from_payload(payload: &Value) -> Option<String> {
    let raw = payload.get("input").and_then(Value::as_str)?;
    let parsed: Value = serde_json::from_str(raw).ok()?;
    let cmd = parsed.get("cmd")?.as_str()?.trim();
    let command = cmd.split_whitespace().next()?;
    let base = Path::new(command).file_name()?.to_str()?;
    Some(base.to_owned())
}

fn command_families_from_execution(value: &Value) -> Vec<String> {
    let item = value
        .get("payload")
        .and_then(|p| p.get("item"))
        .unwrap_or(&Value::Null);
    let mut out = Vec::new();

    if let Some(parsed) = item.get("parsed_cmd").and_then(Value::as_array) {
        for entry in parsed {
            if let Some(cmd) = entry.get("cmd").and_then(Value::as_str) {
                if let Some(name) = shell_command_family(cmd) {
                    out.push(name);
                }
            }
        }
    }

    if out.is_empty() {
        if let Some(command) = item.get("command").and_then(Value::as_array) {
            let args = command.iter().filter_map(Value::as_str).collect::<Vec<_>>();
            let cmd = if args.len() >= 3
                && matches!(args[0], "/bin/bash" | "bash" | "/bin/sh" | "sh")
                && args[1] == "-lc"
            {
                args[2]
            } else {
                args.first().copied().unwrap_or("")
            };
            if let Some(name) = shell_command_family(cmd) {
                out.push(name);
            }
        }
    }

    out
}

fn shell_command_family(cmd: &str) -> Option<String> {
    let mut words = cmd.split_whitespace();
    let mut first = words.next()?;
    while first.contains('=') && !first.starts_with('/') {
        first = words.next()?;
    }
    let base = Path::new(first).file_name()?.to_str()?;
    Some(
        base.trim_matches(|c: char| c == '\'' || c == '"')
            .to_owned(),
    )
}

fn observed_commit_from_output(text: &str) -> Option<ObservedCommit> {
    let header = Regex::new(r"\[[^\]]+\s+([0-9a-f]{7,40})\]\s+(.+)").ok()?;
    let caps = header.captures(text)?;
    let hash = caps.get(1)?.as_str().to_owned();
    let subject = caps.get(2)?.as_str().lines().next()?.trim().to_owned();
    let stats = Regex::new(
        r"(?m)(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?",
    )
    .ok();
    let (files_changed, insertions, deletions) = stats
        .and_then(|re| re.captures(text))
        .map(|c| {
            let n = |i| c.get(i).and_then(|m| m.as_str().parse::<u64>().ok());
            (n(1), n(2), n(3))
        })
        .unwrap_or((None, None, None));
    Some(ObservedCommit {
        hash,
        subject,
        files_changed,
        insertions,
        deletions,
    })
}

fn analyze_rollout(identity: &RolloutIdentity) -> Result<(AgentThreadStats, Vec<u64>)> {
    let path = &identity.file;
    let file = File::open(path)
        .with_context(|| format!("Failed to open Codex rollout: {}", path.display()))?;
    let reader = BufReader::new(file);

    let mut main_model = None;
    let mut active_model = None;
    let mut reasoning_effort = None;
    let mut started_at = identity.started_at.clone();
    let mut ended_at = None;
    let mut usage = TokenUsage::default();
    let mut previous_total: Option<TokenUsage> = None;
    let mut model_calls = 0_u64;
    let mut tool_calls = 0_u64;
    let mut tool_call_ids = HashSet::new();
    let mut compactions = 0_u64;
    let mut inherited_records_skipped = 0_u64;
    let mut call_inputs = Vec::new();
    let mut account_quota_first = None;
    let mut account_quota_last = None;
    let mut by_model: HashMap<String, AgentModelStats> = HashMap::new();
    let mut models_seen = HashSet::new();
    let mut warnings = Vec::new();
    let mut first_user_request = None;
    let mut skills = HashSet::new();
    let mut referenced_plans = HashSet::new();
    let mut command_families: HashMap<String, u64> = HashMap::new();
    let mut commits = Vec::new();
    let mut task_completions = 0_u64;
    let mut final_result = None;

    if identity.parent_thread_id.is_some()
        && identity.forked_from_id.is_some()
        && identity.subagent_history_start_ordinal.is_none()
    {
        warnings.push(
            "subagent rollout has fork metadata but no subagent history boundary; inherited non-usage records cannot be distinguished"
                .to_string(),
        );
    }

    for (line_number, line) in reader.lines().enumerate() {
        let line = line.with_context(|| {
            format!(
                "Failed reading {} at line {}",
                path.display(),
                line_number + 1
            )
        })?;
        let line = line.trim_start_matches('\u{feff}');
        let value: Value = serde_json::from_str(line).with_context(|| {
            format!(
                "Invalid JSON in {} at line {}",
                path.display(),
                line_number + 1
            )
        })?;

        let top_type = value.get("type").and_then(Value::as_str);
        let timestamp = value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);

        if started_at.is_none() {
            started_at = timestamp.clone();
        }
        if timestamp.is_some() {
            ended_at = timestamp;
        }

        if top_type != Some("session_meta") && rollout_line_is_inherited(identity, &value) {
            inherited_records_skipped += 1;

            // In copied-history subagent rollouts, seed the cumulative usage
            // baseline from inherited token snapshots without charging them to
            // the child. Otherwise the first child-local cumulative snapshot
            // would incorrectly re-count the parent's lifetime usage.
            if top_type == Some("event_msg")
                && json_str(&value, &["payload", "type"]).as_deref() == Some("token_count")
            {
                if let Some(total_value) = value
                    .get("payload")
                    .and_then(|payload| payload.get("info"))
                    .and_then(|info| info.get("total_token_usage"))
                {
                    previous_total = Some(TokenUsage::from_json(total_value));
                }
            }

            // Preserve the inherited active model only as context for assigning
            // the first child-local usage delta. No inherited tokens/tools are
            // counted.
            if top_type == Some("turn_context") {
                if let Some(candidate) = json_str(&value, &["payload", "model"]) {
                    active_model = Some(candidate.clone());
                    set_main_model(&mut main_model, Some(candidate));
                }
            }
            continue;
        }

        extract_plan_paths(line, &mut referenced_plans);

        match top_type {
            Some("session_meta") => {
                let payload = value.get("payload").unwrap_or(&Value::Null);
                let meta = session_meta_object(payload);
                let candidate = meta
                    .get("base_instructions")
                    .and_then(|base| base.get("provenance"))
                    .and_then(|prov| prov.get("model"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                set_main_model(&mut main_model, candidate.clone());
                if active_model.is_none() {
                    active_model = candidate;
                }
            }
            Some("turn_context") => {
                let candidate = json_str(&value, &["payload", "model"]);
                if let Some(candidate) = candidate {
                    active_model = Some(candidate.clone());
                    set_main_model(&mut main_model, Some(candidate.clone()));
                    if !is_auxiliary_model(&candidate) && reasoning_effort.is_none() {
                        reasoning_effort = json_str(&value, &["payload", "effort"]).or_else(|| {
                            json_str(
                                &value,
                                &[
                                    "payload",
                                    "collaboration_mode",
                                    "settings",
                                    "reasoning_effort",
                                ],
                            )
                        });
                    }
                }
            }
            Some("world_state") => {
                let candidate = json_str(&value, &["payload", "state", "model"]);
                if active_model.is_none() {
                    active_model = candidate.clone();
                }
                set_main_model(&mut main_model, candidate);
                if reasoning_effort.is_none() {
                    reasoning_effort = json_str(
                        &value,
                        &[
                            "payload",
                            "state",
                            "collaboration_mode",
                            "settings",
                            "reasoning_effort",
                        ],
                    );
                }
            }
            Some("compacted") => compactions += 1,
            Some("response_item") => {
                let payload = value.get("payload").unwrap_or(&Value::Null);
                if let Some(text) = extract_user_text(payload) {
                    if first_user_request.is_none() {
                        first_user_request = Some(truncate_one_line(&text, 180));
                    }
                    extract_plan_paths(&text, &mut referenced_plans);
                }
                extract_skill_names(payload, &mut skills);
                if looks_like_tool_call(payload) {
                    if let Some(family) = command_family_from_payload(payload) {
                        *command_families.entry(family).or_insert(0) += 1;
                    }
                    let is_new = if let Some(call_id) = payload
                        .get("call_id")
                        .or_else(|| payload.get("id"))
                        .and_then(Value::as_str)
                    {
                        tool_call_ids.insert(call_id.to_owned())
                    } else {
                        true
                    };
                    if is_new {
                        tool_calls += 1;
                        let model_name = active_model
                            .as_deref()
                            .or(main_model.as_deref())
                            .unwrap_or("unknown")
                            .to_owned();
                        by_model.entry(model_name).or_default().tool_calls += 1;
                    }
                }
            }
            Some("event_msg") => {
                let payload_type = json_str(&value, &["payload", "type"]);
                extract_skill_names(&value, &mut skills);
                if payload_type.as_deref() == Some("task_complete") {
                    task_completions += 1;
                    if let Some(message) = json_str(&value, &["payload", "last_agent_message"]) {
                        final_result = Some(truncate_one_line(&message, 220));
                    }
                }
                if let Some(item_type) = json_str(&value, &["payload", "item", "type"]) {
                    if item_type == "CommandExecution" {
                        for family in command_families_from_execution(&value) {
                            *command_families.entry(family).or_insert(0) += 1;
                        }
                        if let Some(stdout) = json_str(&value, &["payload", "item", "stdout"]) {
                            if let Some(commit) = observed_commit_from_output(&stdout) {
                                if !commits
                                    .iter()
                                    .any(|existing: &ObservedCommit| existing.hash == commit.hash)
                                {
                                    commits.push(commit);
                                }
                            }
                        }
                    }
                }

                if payload_type.as_deref() == Some("thread_settings_applied") {
                    if let Some(candidate) =
                        json_str(&value, &["payload", "thread_settings", "model"])
                    {
                        active_model = Some(candidate.clone());
                        set_main_model(&mut main_model, Some(candidate.clone()));
                        if !is_auxiliary_model(&candidate) && reasoning_effort.is_none() {
                            reasoning_effort = json_str(
                                &value,
                                &["payload", "thread_settings", "reasoning_effort"],
                            );
                        }
                    }
                } else if payload_type.as_deref() == Some("token_count") {
                    // Rate limits are account-wide observations, not usage attributable
                    // to this workflow. Keep them only as first/last observations.
                    if let Some(percent) = json_f64(
                        &value,
                        &["payload", "rate_limits", "primary", "used_percent"],
                    ) {
                        account_quota_first.get_or_insert(percent);
                        account_quota_last = Some(percent);
                    }

                    let total_value = value
                        .get("payload")
                        .and_then(|payload| payload.get("info"))
                        .and_then(|info| info.get("total_token_usage"));

                    if let Some(total_value) = total_value {
                        let total = TokenUsage::from_json(total_value);
                        let delta = total.delta_from(previous_total);
                        previous_total = Some(total);

                        // Ignore duplicate token_count snapshots. They are common and
                        // otherwise make sum(last_token_usage) overcount badly.
                        if !delta.is_zero() {
                            model_calls += 1;
                            usage.add_assign(delta);
                            call_inputs.push(delta.input_tokens);

                            let model_name = active_model
                                .as_deref()
                                .or(main_model.as_deref())
                                .unwrap_or("unknown")
                                .to_owned();
                            models_seen.insert(model_name.clone());
                            let entry = by_model.entry(model_name).or_default();
                            entry.model_calls += 1;
                            entry.add_usage(delta);
                        }
                    }
                } else if payload_type
                    .as_deref()
                    .is_some_and(|kind| kind == "compacted" || kind == "compact")
                {
                    compactions += 1;
                }
            }
            _ => {}
        }
    }

    for model in models_seen {
        if let Some(entry) = by_model.get_mut(&model) {
            entry.threads = 1;
        }
    }

    call_inputs.sort_unstable();
    let median = percentile(&call_inputs, 1, 2);
    let p90 = percentile(&call_inputs, 9, 10);
    let peak = call_inputs.last().copied().unwrap_or(0);

    if main_model.is_none() {
        main_model = active_model.filter(|model| !is_auxiliary_model(model));
    }

    Ok((
        AgentThreadStats {
            thread_id: identity.thread_id.clone(),
            parent_thread_id: identity.parent_thread_id.clone(),
            source_kind: identity.source_kind.clone(),
            agent_path: identity.agent_path.clone(),
            agent_nickname: identity.agent_nickname.clone(),
            agent_role: identity.agent_role.clone(),
            file: path.display().to_string(),
            cwd: identity.cwd.clone(),
            repository_url: identity.repository_url.clone(),
            git_branch: identity.git_branch.clone(),
            git_commit_start: identity.git_commit.clone(),
            first_user_request,
            skills: {
                let mut v: Vec<_> = skills.into_iter().collect();
                v.sort();
                v
            },
            referenced_plans: {
                let mut v: Vec<_> = referenced_plans.into_iter().collect();
                v.sort();
                v
            },
            command_families,
            commits,
            task_completions,
            final_result,
            model: main_model,
            reasoning_effort,
            started_at,
            ended_at,
            input_tokens: usage.input_tokens,
            cached_input_tokens: usage.cached_input_tokens,
            cache_write_input_tokens: usage.cache_write_input_tokens,
            uncached_input_tokens: usage.input_tokens.saturating_sub(usage.cached_input_tokens),
            output_tokens: usage.output_tokens,
            reasoning_output_tokens: usage.reasoning_output_tokens,
            model_calls,
            tool_calls,
            compactions,
            inherited_records_skipped,
            median_input_tokens_per_call: median,
            p90_input_tokens_per_call: p90,
            peak_input_tokens_per_call: peak,
            account_weekly_used_percent_first: account_quota_first,
            account_weekly_used_percent_last: account_quota_last,
            by_model,
            warnings,
        },
        call_inputs,
    ))
}

fn build_assessment(
    model_calls: u64,
    peak: u64,
    compactions: u64,
    policy: &AgentStatsPolicy,
) -> Vec<String> {
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

    assessment
}

fn analyze_workflow(
    index: &HashMap<String, RolloutIdentity>,
    root_thread_id: &str,
    policy: &AgentStatsPolicy,
) -> Result<AgentWorkflowStats> {
    let ids = workflow_thread_ids(index, root_thread_id);
    let mut threads = Vec::new();
    let mut all_inputs = Vec::new();

    for id in &ids {
        let identity = index
            .get(id)
            .ok_or_else(|| anyhow!("Missing rollout identity for thread {id}"))?;
        let (stats, call_inputs) = analyze_rollout(identity)?;
        threads.push(stats);
        all_inputs.extend(call_inputs);
    }

    threads.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    all_inputs.sort_unstable();

    let root = threads
        .iter()
        .find(|thread| thread.thread_id == root_thread_id)
        .ok_or_else(|| anyhow!("Root rollout {root_thread_id} was not analyzed"))?;

    let mut by_model: HashMap<String, AgentModelStats> = HashMap::new();
    let mut input_tokens = 0_u64;
    let mut cached_input_tokens = 0_u64;
    let mut cache_write_input_tokens = 0_u64;
    let mut output_tokens = 0_u64;
    let mut reasoning_output_tokens = 0_u64;
    let mut model_calls = 0_u64;
    let mut tool_calls = 0_u64;
    let mut compactions = 0_u64;
    let mut inherited_records_skipped = 0_u64;
    let mut review_threads = 0_usize;
    let mut compact_threads = 0_usize;
    let mut warnings = Vec::new();
    let mut skills = HashSet::new();
    let mut referenced_plans = HashSet::new();
    let mut command_families: HashMap<String, u64> = HashMap::new();
    let mut commits: Vec<ObservedCommit> = Vec::new();
    let mut task_completions = 0_u64;

    for thread in &threads {
        input_tokens = input_tokens.saturating_add(thread.input_tokens);
        cached_input_tokens = cached_input_tokens.saturating_add(thread.cached_input_tokens);
        cache_write_input_tokens =
            cache_write_input_tokens.saturating_add(thread.cache_write_input_tokens);
        output_tokens = output_tokens.saturating_add(thread.output_tokens);
        reasoning_output_tokens =
            reasoning_output_tokens.saturating_add(thread.reasoning_output_tokens);
        model_calls = model_calls.saturating_add(thread.model_calls);
        tool_calls = tool_calls.saturating_add(thread.tool_calls);
        compactions = compactions.saturating_add(thread.compactions);
        inherited_records_skipped =
            inherited_records_skipped.saturating_add(thread.inherited_records_skipped);

        if thread.source_kind == "subagent:review" {
            review_threads += 1;
        } else if thread.source_kind == "subagent:compact" {
            compact_threads += 1;
        }

        for warning in &thread.warnings {
            warnings.push(format!("{}: {warning}", thread.thread_id));
        }
        for skill in &thread.skills {
            skills.insert(skill.clone());
        }
        for plan in &thread.referenced_plans {
            referenced_plans.insert(plan.clone());
        }
        for (family, count) in &thread.command_families {
            *command_families.entry(family.clone()).or_insert(0) += count;
        }
        for commit in &thread.commits {
            if !commits.iter().any(|existing| existing.hash == commit.hash) {
                commits.push(commit.clone());
            }
        }
        task_completions = task_completions.saturating_add(thread.task_completions);

        for (model, usage) in &thread.by_model {
            let entry = by_model.entry(model.clone()).or_default();
            entry.threads = entry.threads.saturating_add(usage.threads);
            entry.input_tokens = entry.input_tokens.saturating_add(usage.input_tokens);
            entry.cached_input_tokens = entry
                .cached_input_tokens
                .saturating_add(usage.cached_input_tokens);
            entry.cache_write_input_tokens = entry
                .cache_write_input_tokens
                .saturating_add(usage.cache_write_input_tokens);
            entry.output_tokens = entry.output_tokens.saturating_add(usage.output_tokens);
            entry.reasoning_output_tokens = entry
                .reasoning_output_tokens
                .saturating_add(usage.reasoning_output_tokens);
            entry.model_calls = entry.model_calls.saturating_add(usage.model_calls);
            entry.tool_calls = entry.tool_calls.saturating_add(usage.tool_calls);
        }
    }

    let started_at = threads
        .iter()
        .filter_map(|thread| thread.started_at.clone())
        .min();
    let ended_at = threads
        .iter()
        .filter_map(|thread| thread.ended_at.clone())
        .max();

    let account_quota_first = threads
        .iter()
        .filter_map(|thread| {
            thread
                .started_at
                .as_ref()
                .zip(thread.account_weekly_used_percent_first)
                .map(|(timestamp, percent)| (timestamp.clone(), percent))
        })
        .min_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, percent)| percent);

    let account_quota_last = threads
        .iter()
        .filter_map(|thread| {
            thread
                .ended_at
                .as_ref()
                .zip(thread.account_weekly_used_percent_last)
                .map(|(timestamp, percent)| (timestamp.clone(), percent))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, percent)| percent);

    let median = percentile(&all_inputs, 1, 2);
    let p90 = percentile(&all_inputs, 9, 10);
    let peak = all_inputs.last().copied().unwrap_or(0);
    let calls_over_100k = all_inputs.iter().filter(|&&v| v >= 100_000).count() as u64;
    let calls_over_120k = all_inputs.iter().filter(|&&v| v >= 120_000).count() as u64;
    let calls_over_200k = all_inputs.iter().filter(|&&v| v >= 200_000).count() as u64;
    let cached_input_percent = if input_tokens == 0 {
        0.0
    } else {
        cached_input_tokens as f64 * 100.0 / input_tokens as f64
    };
    let uncached = input_tokens.saturating_sub(cached_input_tokens);
    let replay_amplification = (uncached > 0).then(|| input_tokens as f64 / uncached as f64);
    // Main-thread health is the primary optimization target. Delegated
    // explorer pressure is reported separately instead of making a healthy
    // root workflow look unhealthy.
    let assessment = build_assessment(
        root.model_calls,
        root.peak_input_tokens_per_call,
        root.compactions,
        policy,
    );

    Ok(AgentWorkflowStats {
        root_thread_id: root_thread_id.to_owned(),
        root_file: root.file.clone(),
        root_source: root.source_kind.clone(),
        cwd: root.cwd.clone(),
        repository_url: root.repository_url.clone(),
        git_branch: root.git_branch.clone(),
        git_commit_start: root.git_commit_start.clone(),
        first_user_request: root.first_user_request.clone(),
        skills: {
            let mut v: Vec<_> = skills.into_iter().collect();
            v.sort();
            v
        },
        referenced_plans: {
            let mut v: Vec<_> = referenced_plans.into_iter().collect();
            v.sort();
            v
        },
        command_families,
        commits,
        task_completions,
        final_result: root.final_result.clone(),
        model: root.model.clone(),
        reasoning_effort: root.reasoning_effort.clone(),
        started_at,
        ended_at,
        threads: threads.len(),
        spawned_threads: threads.len().saturating_sub(1),
        review_threads,
        compact_threads,
        input_tokens,
        cached_input_tokens,
        cache_write_input_tokens,
        uncached_input_tokens: input_tokens.saturating_sub(cached_input_tokens),
        output_tokens,
        reasoning_output_tokens,
        model_calls,
        tool_calls,
        compactions,
        inherited_records_skipped,
        median_input_tokens_per_call: median,
        p90_input_tokens_per_call: p90,
        peak_input_tokens_per_call: peak,
        calls_over_100k,
        calls_over_120k,
        calls_over_200k,
        cached_input_percent,
        replay_amplification,
        account_weekly_used_percent_first: account_quota_first,
        account_weekly_used_percent_last: account_quota_last,
        by_model,
        thread_details: threads,
        warnings,
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

fn percent(count: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        count as f64 * 100.0 / total as f64
    }
}

fn cached_percent(input: u64, cached: u64) -> f64 {
    percent(cached, input)
}

fn replay_amplification(input: u64, uncached: u64) -> Option<f64> {
    (uncached > 0).then(|| input as f64 / uncached as f64)
}

fn top_commands(commands: &HashMap<String, u64>, limit: usize) -> Option<String> {
    if commands.is_empty() {
        return None;
    }
    let mut commands: Vec<_> = commands.iter().collect();
    commands.sort_by_key(|(name, count)| (std::cmp::Reverse(**count), *name));
    Some(
        commands
            .into_iter()
            .take(limit)
            .map(|(name, count)| format!("{name} {count}"))
            .collect::<Vec<_>>()
            .join(" · "),
    )
}

fn is_repository_read_command(name: &str) -> bool {
    matches!(
        name,
        "rg" | "grep" | "find" | "fd" | "sed" | "cat" | "nl" | "head" | "tail" | "awk" | "less"
    )
}

fn repository_read_commands(commands: &HashMap<String, u64>) -> u64 {
    commands
        .iter()
        .filter(|(name, _)| is_repository_read_command(name))
        .map(|(_, count)| *count)
        .sum()
}

fn main_thread_health(thread: &AgentThreadStats, policy: &AgentStatsPolicy) -> &'static str {
    if thread.model_calls > policy.bad_model_calls
        || thread.peak_input_tokens_per_call >= policy.bad_peak_input_tokens
        || thread.compactions >= policy.bad_compactions
    {
        "RUNAWAY"
    } else if thread.model_calls > policy.warn_model_calls
        || thread.peak_input_tokens_per_call >= policy.warn_peak_input_tokens
        || thread.compactions >= policy.warn_compactions
    {
        "PRESSURED"
    } else {
        "HEALTHY"
    }
}

fn delegation_grade(
    spawned_threads: usize,
    main_input_share: f64,
    repository_read_offload: Option<f64>,
) -> &'static str {
    if spawned_threads == 0 {
        return "NONE";
    }
    let read_strong = repository_read_offload.is_none_or(|value| value >= 80.0);
    let read_good = repository_read_offload.is_none_or(|value| value >= 60.0);
    if main_input_share <= 25.0 && read_strong {
        "STRONG"
    } else if main_input_share <= 40.0 && read_good {
        "GOOD"
    } else if main_input_share <= 60.0 {
        "WEAK"
    } else {
        "POOR"
    }
}

fn delegated_thread_label(thread: &AgentThreadStats, index: usize, total: usize) -> String {
    let base = thread
        .agent_role
        .as_deref()
        .or(thread.agent_nickname.as_deref())
        .or_else(|| {
            thread
                .agent_path
                .as_deref()
                .and_then(|path| path.rsplit('/').find(|part| !part.is_empty()))
        })
        .unwrap_or("agent");

    if total == 1 {
        base.to_string()
    } else {
        format!("{base} {}", index + 1)
    }
}

fn thread_usage_model(thread: &AgentThreadStats) -> &str {
    thread
        .by_model
        .iter()
        .filter(|(model, _)| !is_auxiliary_model(model))
        .max_by_key(|(_, usage)| usage.input_tokens)
        .map(|(model, _)| model.as_str())
        .or_else(|| thread.model.as_deref())
        .unwrap_or("unknown")
}

fn print_agent_stats(stats: &AgentWorkflowStats, policy: &AgentStatsPolicy) {
    let root = stats
        .thread_details
        .iter()
        .find(|thread| thread.thread_id == stats.root_thread_id)
        .expect("workflow stats must contain the root thread");

    let delegated: Vec<_> = stats
        .thread_details
        .iter()
        .filter(|thread| thread.thread_id != stats.root_thread_id)
        .collect();

    let delegated_input = delegated.iter().map(|t| t.input_tokens).sum::<u64>();
    let delegated_fresh = delegated
        .iter()
        .map(|t| t.uncached_input_tokens)
        .sum::<u64>();
    let delegated_calls = delegated.iter().map(|t| t.model_calls).sum::<u64>();
    let delegated_compactions = delegated.iter().map(|t| t.compactions).sum::<u64>();

    let main_input_share = percent(root.input_tokens, stats.input_tokens);
    let delegated_input_share = percent(delegated_input, stats.input_tokens);

    let main_repository_reads = repository_read_commands(&root.command_families);
    let delegated_repository_reads = delegated
        .iter()
        .map(|thread| repository_read_commands(&thread.command_families))
        .sum::<u64>();
    let total_repository_reads = main_repository_reads.saturating_add(delegated_repository_reads);
    let repository_read_offload = (total_repository_reads > 0)
        .then(|| percent(delegated_repository_reads, total_repository_reads));

    let main_health = main_thread_health(root, policy);
    let delegation = delegation_grade(
        stats.spawned_threads,
        main_input_share,
        repository_read_offload,
    );

    println!("Codex session");
    println!("────────────────────────────────────────────────────────");
    if let Some(cwd) = &stats.cwd {
        println!("Workspace          {cwd}");
    }
    if let Some(branch) = &stats.git_branch {
        let commit = stats.git_commit_start.as_deref().unwrap_or("unknown");
        println!(
            "Git start          {branch} @ {}",
            truncate_one_line(commit, 12)
        );
    }
    if let Some(repo) = &stats.repository_url {
        println!("Repository         {repo}");
    }
    if let Some(request) = &stats.first_user_request {
        println!("Request            {request}");
    }
    if !stats.skills.is_empty() {
        println!("Skills             {}", stats.skills.join(", "));
    }
    println!(
        "Main model         {}{}",
        thread_usage_model(root),
        root.reasoning_effort
            .as_deref()
            .map(|effort| format!(" / {effort}"))
            .unwrap_or_default()
    );
    println!(
        "Threads            {} ({} delegated)",
        stats.threads, stats.spawned_threads
    );
    if let Some(result) = &stats.final_result {
        println!("Last result        {result}");
    }

    if !stats.commits.is_empty() {
        println!();
        println!("Observed output");
        for commit in &stats.commits {
            let mut suffix = String::new();
            if let Some(files) = commit.files_changed {
                suffix.push_str(&format!(" · {files} files"));
            }
            match (commit.insertions, commit.deletions) {
                (Some(ins), Some(del)) => suffix.push_str(&format!(" · +{ins}/-{del}")),
                (Some(ins), None) => suffix.push_str(&format!(" · +{ins}")),
                (None, Some(del)) => suffix.push_str(&format!(" · -{del}")),
                _ => {}
            }
            println!(
                "Commit             {} {}{}",
                commit.hash, commit.subject, suffix
            );
        }
    }

    println!();
    println!("Efficiency");
    println!(
        "Main               {:20} {:>8} input · {:>7} fresh · {:>3} calls · p90 {:>7} · peak {:>7}",
        thread_usage_model(root),
        format_tokens(root.input_tokens),
        format_tokens(root.uncached_input_tokens),
        root.model_calls,
        format_tokens(root.p90_input_tokens_per_call),
        format_tokens(root.peak_input_tokens_per_call),
    );

    for (index, thread) in delegated.iter().enumerate() {
        let label = delegated_thread_label(thread, index, delegated.len());
        println!(
            "{:<18} {:20} {:>8} input · {:>7} fresh · {:>3} calls · p90 {:>7} · peak {:>7}",
            label,
            thread_usage_model(thread),
            format_tokens(thread.input_tokens),
            format_tokens(thread.uncached_input_tokens),
            thread.model_calls,
            format_tokens(thread.p90_input_tokens_per_call),
            format_tokens(thread.peak_input_tokens_per_call),
        );
    }

    if delegated.is_empty() {
        println!("Offload            none");
    } else if let Some(read_offload) = repository_read_offload {
        println!(
            "Offload            {:.1}% input · {:.1}% repo reads",
            delegated_input_share, read_offload
        );
    } else {
        println!("Offload            {:.1}% input", delegated_input_share);
    }

    println!(
        "Total              {} input · {} fresh · {} calls",
        format_tokens(stats.input_tokens),
        format_tokens(stats.uncached_input_tokens),
        stats.model_calls
    );

    println!();
    println!(
        "Health             main {} · delegation {} · {} compactions",
        main_health, delegation, stats.compactions
    );

    if delegated_compactions > 0 {
        println!(
            "Note               delegated context compacted {} time{}",
            delegated_compactions,
            if delegated_compactions == 1 { "" } else { "s" }
        );
    }

    if !stats.warnings.is_empty() {
        println!();
        println!("Scanner warnings");
        for warning in &stats.warnings {
            println!("  WARN: {warning}");
        }
    }
}

fn cmd_agent_stats(last: usize, file: Option<PathBuf>, json: bool) -> Result<()> {
    let config = load_agent_config()?;
    let index = rollout_index()?;

    let root_ids = if let Some(file) = file {
        if !file.is_file() {
            bail!("Rollout file does not exist: {}", file.display());
        }
        let identity = read_rollout_identity(&file)?;
        let root = root_thread_id(&index, &identity.thread_id);
        vec![root]
    } else {
        recent_root_thread_ids(&index, last)?
    };

    let stats = root_ids
        .iter()
        .map(|root| analyze_workflow(&index, root, &config.stats))
        .collect::<Result<Vec<_>>>()?;

    if json {
        println!("{}", serde_json::to_string_pretty(&stats)?);
        return Ok(());
    }

    for (position, workflow) in stats.iter().enumerate() {
        if position > 0 {
            println!("\n");
        }
        print_agent_stats(workflow, &config.stats);
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
        Commands::Reconcile { from, to, apply } => cmd_reconcile(from, to, apply),
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
