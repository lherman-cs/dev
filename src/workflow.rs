//! Deterministic middleware for the development workflow.
//!
//! Authority boundaries are intentionally small:
//! - Git stores code and candidate reality.
//! - The approved Markdown spec stores product semantics.
//! - SQLite stores only workflow bookkeeping.
//!
//! Agents interact through semantic `dev workflow` commands and never through
//! SQL, table names, database files, or serialized workflow state.

use anyhow::{Context, Result, anyhow, bail, ensure};
use clap::{Subcommand, ValueEnum};
use serde_json::{Value, json};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const SCHEMA_VERSION: i64 = 1;
const MAX_REPLANS: i64 = 1;
const MAX_VERIFICATION_FAILURES: i64 = 2;
const MAX_REVIEW_DIFF_BYTES: usize = 96 * 1024;
const MAX_FINAL_DIFF_BYTES: usize = 160 * 1024;
const OUTPUT_LIMIT: usize = 16 * 1024;

#[derive(Debug, Subcommand)]
pub enum WorkflowAction {
    /// Create or recover the durable workflow state for this Git worktree.
    Init {
        /// Human-approved Markdown specification.
        #[arg(long)]
        spec: PathBuf,
        /// Replace an existing workflow database. Intended only for deliberate restart.
        #[arg(long)]
        reset: bool,
    },
    /// Return a compact view of durable workflow state.
    Status,
    /// Return the single next action. This is the controller's normal hot path.
    Next,
    /// Planner-owned operations. No plan.md is created.
    Plan {
        #[command(subcommand)]
        action: PlanAction,
    },
    /// Return the current task contract; optionally include candidate review evidence.
    Task {
        #[arg(long)]
        task: i64,
        /// Include exact candidate diff and open findings for Reviewer.
        #[arg(long)]
        review: bool,
    },
    /// Builder submits an exact committed candidate. Required checks run here.
    Candidate {
        #[command(subcommand)]
        action: CandidateAction,
    },
    /// Reviewer records findings and finishes one candidate-scoped review.
    Review {
        #[command(subcommand)]
        action: ReviewAction,
    },
    /// Route one demonstrated material execution-plan defect back to Planner.
    Replan {
        #[arg(long)]
        reason: String,
    },
    /// Explicit human intervention and recovery points.
    Human {
        #[command(subcommand)]
        action: HumanAction,
    },
    /// Whole-project final-review operations.
    Final {
        #[command(subcommand)]
        action: FinalAction,
    },
}

#[derive(Debug, Subcommand)]
pub enum PlanAction {
    /// Add one coherent independently reviewable task.
    Add {
        #[arg(long)]
        title: String,
        #[arg(long)]
        goal: String,
        #[arg(long = "requirement")]
        requirements: Vec<String>,
        #[arg(long = "path")]
        paths: Vec<String>,
        #[arg(long = "check")]
        checks: Vec<String>,
        #[arg(long = "depends-on")]
        depends_on: Vec<i64>,
    },
    /// Add a whole-project verification command, executed without a shell.
    FinalCheck {
        #[arg(long)]
        check: String,
    },
    /// Declare the compiled task queue executable.
    Ready,
}

#[derive(Debug, Subcommand)]
pub enum CandidateAction {
    Submit {
        #[arg(long)]
        task: i64,
        /// Commit-ish; resolved to a full commit SHA before state changes.
        #[arg(long)]
        sha: String,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum FindingSeverity {
    Critical,
    Important,
    Minor,
}

impl FindingSeverity {
    fn as_str(self) -> &'static str {
        match self {
            Self::Critical => "critical",
            Self::Important => "important",
            Self::Minor => "minor",
        }
    }

    fn blocking(self) -> bool {
        !matches!(self, Self::Minor)
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum FindingOrigin {
    Candidate,
    RepairRegression,
    LateDiscovery,
}

impl FindingOrigin {
    fn as_str(self) -> &'static str {
        match self {
            Self::Candidate => "candidate",
            Self::RepairRegression => "repair-regression",
            Self::LateDiscovery => "late-discovery",
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum ReviewVerdict {
    Pass,
    FixesRequired,
}

impl ReviewVerdict {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::FixesRequired => "fixes_required",
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum Resolution {
    Resolved,
    StillOpen,
}

impl Resolution {
    fn as_str(self) -> &'static str {
        match self {
            Self::Resolved => "resolved",
            Self::StillOpen => "still_open",
        }
    }
}

#[derive(Debug, Subcommand)]
pub enum ReviewAction {
    /// Add one concrete candidate-scoped finding. Minor findings never block advancement.
    Finding {
        #[arg(long)]
        task: i64,
        #[arg(long, value_enum)]
        severity: FindingSeverity,
        #[arg(long, value_enum, default_value = "candidate")]
        origin: FindingOrigin,
        #[arg(long)]
        summary: String,
        #[arg(long)]
        evidence: String,
    },
    /// Account for a blocker from the previous review during the one bounded rereview.
    Resolve {
        #[arg(long)]
        task: i64,
        #[arg(long)]
        finding: i64,
        #[arg(long, value_enum)]
        resolution: Resolution,
        #[arg(long)]
        evidence: String,
    },
    /// Atomically close the current review round after findings/resolutions are complete.
    Finish {
        #[arg(long)]
        task: i64,
        #[arg(long, value_enum)]
        verdict: ReviewVerdict,
    },
    /// Clear an unfinished review draft after a lost reviewer; never alters a completed review.
    Reset {
        #[arg(long)]
        task: i64,
    },
}

#[derive(Debug, Subcommand)]
pub enum HumanAction {
    /// Pause safely and persist the exact question that requires human authority.
    Ask {
        #[arg(long)]
        question: String,
    },
    /// Record the exact human answer as a spec amendment and resume through Planner.
    Answer {
        #[arg(long)]
        request: i64,
        #[arg(long)]
        answer: String,
    },
    /// Pause for an operational reason without manufacturing a semantic question.
    Pause {
        #[arg(long)]
        reason: String,
    },
    /// Deliberately adopt a human-created clean HEAD as the new execution baseline.
    AdoptHead {
        #[arg(long)]
        reason: String,
    },
    /// Resume an operational pause without changing semantics.
    Resume,
}

#[derive(Debug, Subcommand)]
pub enum FinalAction {
    /// Return exact final-review evidence: approved spec identity, integrated diff, and checks.
    Context,
    /// Add one whole-project final-review finding.
    Finding {
        #[arg(long, value_enum)]
        severity: FindingSeverity,
        #[arg(long, value_enum, default_value = "candidate")]
        origin: FindingOrigin,
        #[arg(long)]
        summary: String,
        #[arg(long)]
        evidence: String,
    },
    /// Account for each initial final blocker during the single final rereview.
    Resolve {
        #[arg(long)]
        finding: i64,
        #[arg(long, value_enum)]
        resolution: Resolution,
        #[arg(long)]
        evidence: String,
    },
    /// Finish initial final review or its single rereview.
    Finish {
        #[arg(long, value_enum)]
        verdict: ReviewVerdict,
    },
    /// Submit the one integrated final repair candidate and rerun final checks.
    Candidate {
        #[arg(long)]
        sha: String,
    },
}

#[derive(Debug, Clone)]
struct Runtime {
    repo: PathBuf,
    db: PathBuf,
}

#[derive(Debug)]
struct ProcessResult {
    code: i32,
    stdout: String,
    stderr: String,
}

pub fn run(action: WorkflowAction) -> Result<()> {
    match action {
        WorkflowAction::Init { spec, reset } => Runtime::init(&spec, reset)?.print_status(),
        other => {
            let rt = Runtime::open()?;
            match rt.dispatch(other) {
                Ok(()) => { rt.reset_invalid_calls()?; Ok(()) }
                Err(error) => {
                    let _ = rt.record_invalid_call(&format!("{error:#}"));
                    Err(error)
                }
            }
        }
    }
}

impl Runtime {
    include!("workflow_parts/storage.rs");
    include!("workflow_parts/planning.rs");
    include!("workflow_parts/dispatch.rs");
    include!("workflow_parts/candidate_review.rs");
    include!("workflow_parts/review_finish.rs");
    include!("workflow_parts/human_final.rs");
    include!("workflow_parts/final_review.rs");
    include!("workflow_parts/db.rs");
}

include!("workflow_parts/helpers.rs");
include!("workflow_parts/values.rs");
