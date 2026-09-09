use super::model::*;
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn git(root: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .context("launch git")?;
    ensure!(
        out.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(String::from_utf8(out.stdout)
        .context("Git output is not UTF-8")?
        .trim()
        .to_owned())
}
pub fn head(root: &Path) -> Result<String> {
    git(root, &["rev-parse", "--verify", "HEAD^{commit}"])
}
pub fn ancestor(root: &Path, old: &str, new: &str) -> Result<bool> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["merge-base", "--is-ancestor", old, new])
        .output()?;
    match out.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => bail!(
            "cannot resolve Git ancestry: {}",
            String::from_utf8_lossy(&out.stderr)
        ),
    }
}
pub fn exact_commit(root: &Path, value: &str) -> Result<()> {
    ensure!(
        (value.len() == 40 || value.len() == 64) && value.bytes().all(|b| b.is_ascii_hexdigit()),
        "expected full Git object ID, got {value}"
    );
    ensure!(
        git(
            root,
            &["rev-parse", "--verify", &format!("{value}^{{commit}}")]
        )? == value,
        "not an exact commit"
    );
    Ok(())
}
pub fn hash(root: &Path, bytes: &[u8]) -> Result<String> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["hash-object", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .context("missing hash stdin")?
        .write_all(bytes)?;
    let out = child.wait_with_output()?;
    ensure!(out.status.success(), "git hash-object failed");
    Ok(String::from_utf8(out.stdout)?.trim().to_owned())
}
pub fn clean(root: &Path) -> Result<()> {
    let dirty = git(
        root,
        &[
            "status",
            "--porcelain",
            "--untracked-files=normal",
            "--",
            ".",
            ":(exclude)plans/**",
        ],
    )?;
    ensure!(
        dirty.is_empty(),
        "source worktree is not clean; preserve and reconcile these changes, never reset them:\n{dirty}"
    );
    Ok(())
}
pub fn contained(root: &Path, name: &str) -> Result<PathBuf> {
    relative(name)?;
    let path = root
        .join(name)
        .canonicalize()
        .with_context(|| format!("missing path {name}"))?;
    ensure!(path.starts_with(root), "symlink escapes root: {name}");
    Ok(path)
}
pub fn read_limited(path: &Path) -> Result<String> {
    ensure!(
        fs::metadata(path)?.len() <= 2 * 1024 * 1024,
        "artifact exceeds 2 MiB: {}",
        path.display()
    );
    fs::read_to_string(path).with_context(|| format!("read {}", path.display()))
}
pub fn load_bundle(project: &Path) -> Result<Bundle> {
    let manifest: Manifest = serde_json::from_str(&read_limited(&contained(project, "project.json")?)?)
        .context("project.json is invalid; use $dev-plan to prepare/adopt this project without discarding existing work")?;
    let mut documents = BTreeMap::new();
    for file in std::iter::once(&manifest.spec).chain(manifest.plans.iter().map(|p| &p.file)) {
        documents.insert(file.clone(), read_limited(&contained(project, file)?)?);
    }
    let bundle = Bundle {
        manifest,
        documents,
    };
    bundle.validate()?;
    Ok(bundle)
}
pub fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("artifact has no parent")?;
    fs::create_dir_all(parent)?;
    ensure!(
        !path.is_symlink(),
        "refusing symlink artifact: {}",
        path.display()
    );
    let tmp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .context("missing filename")?
            .to_string_lossy(),
        std::process::id()
    ));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts
        .open(&tmp)
        .with_context(|| format!("create {}", tmp.display()))?;
    let result = (|| -> Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, path)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct PlanState {
    pub base: String,
    pub candidate: Option<String>,
    pub accepted: Option<String>,
    pub build: Option<Report>,
    pub review: Option<Report>,
    pub stalled: bool,
    pub legacy: bool,
    pub decisions: Vec<String>,
    pub evidence_seen: Vec<String>,
    pub routes: Vec<String>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum Phase {
    Readiness,
    Approval,
    Select,
    Build,
    Diagnose,
    Review,
    Lead,
    Explore,
    Adjudicate,
    Maintain,
    MaintenanceReview,
    Final,
    Complete,
    Stopped,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pending {
    pub id: String,
    pub role: String,
    pub key: String,
    pub revision: String,
    pub prompt: String,
    pub pid: Option<u32>,
    pub process_identity: Option<String>,
    pub schema: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Receipt {
    pub id: String,
    pub revision: String,
    pub passed: bool,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub log: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ready {
    pub digest: String,
    pub revision: String,
    pub report: Report,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct State {
    pub version: u32,
    pub root: PathBuf,
    pub project: PathBuf,
    pub bundle: Bundle,
    pub digest: String,
    pub approved: Option<String>,
    pub checks_authorized: Option<String>,
    pub maintenance_history: Vec<serde_json::Value>,
    pub ready: Option<Ready>,
    pub phase: Phase,
    pub target: String,
    pub instruction: String,
    pub plans: BTreeMap<String, PlanState>,
    pub sessions: BTreeMap<String, String>,
    pub pending: Option<Pending>,
    pub proposal: Option<Bundle>,
    pub promotion: bool,
    pub checks: Vec<Receipt>,
    pub last: Option<Report>,
    pub boundary: Option<Report>,
    pub final_report: Option<Report>,
    pub final_receipts: Vec<Receipt>,
    pub last_revision: String,
    pub sequence: u64,
    pub stop_status: String,
    pub stop_reason: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}
impl State {
    pub fn new(root: PathBuf, project: PathBuf, bundle: Bundle) -> Result<Self> {
        let digest = hash(&root, &serde_json::to_vec(&bundle)?)?;
        let revision = head(&root)?;
        let plans = bundle
            .manifest
            .plans
            .iter()
            .map(|p| {
                (
                    p.id.clone(),
                    PlanState {
                        base: revision.clone(),
                        ..Default::default()
                    },
                )
            })
            .collect();
        Ok(Self {
            version: 1,
            root,
            project,
            bundle,
            digest,
            approved: None,
            checks_authorized: None,
            maintenance_history: Vec::new(),
            ready: None,
            phase: Phase::Readiness,
            target: "@project".into(),
            instruction: String::new(),
            plans,
            sessions: BTreeMap::new(),
            pending: None,
            proposal: None,
            promotion: false,
            checks: Vec::new(),
            last: None,
            boundary: None,
            final_report: None,
            final_receipts: Vec::new(),
            last_revision: revision,
            sequence: 0,
            stop_status: String::new(),
            stop_reason: String::new(),
            input_tokens: 0,
            output_tokens: 0,
        })
    }
    pub fn next_id(&mut self) -> String {
        self.sequence += 1;
        format!("attempt_{:06}", self.sequence)
    }
}
pub struct Store {
    pub dir: PathBuf,
    _lock: File,
}
impl Store {
    pub fn open(root: &Path, project: &Path, acquire: bool) -> Result<Self> {
        let home = dirs::data_local_dir()
            .context("cannot determine user data directory")?
            .join("dev/workflows");
        fs::create_dir_all(&home)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&home, fs::Permissions::from_mode(0o700))?;
        }
        let key = hash(root, root.as_os_str().as_encoded_bytes())?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(home.join(format!("{key}.lock")))?;
        if acquire {
            lock.try_lock()
                .map_err(|e| anyhow::anyhow!("another managed project owns this worktree: {e}"))?;
        }
        let dir = home.join(hash(root, project.as_os_str().as_encoded_bytes())?);
        fs::create_dir_all(dir.join("attempts"))?;
        fs::create_dir_all(dir.join("checks"))?;
        Ok(Self { dir, _lock: lock })
    }
    pub fn load(&self) -> Result<Option<State>> {
        let path = self.dir.join("state.json");
        if !path.exists() {
            return Ok(None);
        }
        let state: State = serde_json::from_str(&fs::read_to_string(path)?)?;
        ensure!(state.version == 1, "unsupported runner state version");
        Ok(Some(state))
    }
    pub fn save(&self, state: &State) -> Result<()> {
        atomic(
            &self.dir.join("state.json"),
            &serde_json::to_vec_pretty(state)?,
        )
    }
    pub fn attempt_dir(&self, id: &str) -> Result<PathBuf> {
        ensure!(identifier(id), "invalid attempt ID");
        let dir = self.dir.join("attempts").join(id);
        fs::create_dir_all(&dir)?;
        Ok(dir)
    }
    pub fn event(&self, value: &impl Serialize) -> Result<()> {
        let mut file = OpenOptions::new()
            .append(true)
            .create(true)
            .open(self.dir.join("events.jsonl"))?;
        serde_json::to_writer(&mut file, value)?;
        file.write_all(b"\n")?;
        file.sync_data()?;
        Ok(())
    }
}

/// PID plus Linux start time avoids treating an unrelated reused PID as our worker.
pub fn process_identity(pid: u32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let tail = stat.rsplit_once(") ")?.1;
        if tail.starts_with('Z') {
            return None;
        }
        return tail.split_whitespace().nth(19).map(str::to_owned);
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        let out = Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "lstart="])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let identity = String::from_utf8(out.stdout).ok()?.trim().to_owned();
        return (!identity.is_empty()).then_some(identity);
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        None
    }
}
pub fn pending_alive(p: &Pending) -> bool {
    match (p.pid, &p.process_identity) {
        (Some(pid), Some(id)) => process_identity(pid).as_ref() == Some(id),
        _ => false,
    }
}
