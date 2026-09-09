//! Execute only the command definitions explicitly approved with the package.
use super::model::*;
use super::store::*;
use anyhow::{Context, Result, ensure};
use serde_json::json;
use std::fs::{self, File};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub fn run(store: &Store, state: &mut State, ids: &[String]) -> Result<Vec<Receipt>> {
    let revision = head(&state.root)?;
    clean(&state.root)?;
    let mut results = Vec::new();
    for id in ids {
        if let Some(old) = state
            .checks
            .iter()
            .rev()
            .find(|r| r.id == *id && r.revision == revision && passed(r))
        {
            results.push(old.clone());
            continue;
        }
        let check = state
            .bundle
            .manifest
            .checks
            .iter()
            .find(|c| c.id == *id)
            .context("unknown verification command")?
            .clone();
        let cwd = contained(&state.root, &check.cwd)?;
        let dir = store.dir.join("checks").join(format!("{id}-{revision}"));
        fs::create_dir_all(&dir)?;
        let running = dir.join("running.json");
        if running.exists() {
            let old: Pending = serde_json::from_str(&fs::read_to_string(&running)?)?;
            ensure!(
                !pending_alive(&old),
                "check {id} is still running; do not start another process"
            );
        }
        let log_path = dir.join(format!("{}.log", state.next_id()));
        let log = File::create(&log_path)?;
        let mut command = Command::new(&check.argv[0]);
        command
            .args(&check.argv[1..])
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log);
        // A timed-out test must not leave its subprocesses racing the next candidate.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        eprintln!("[check {id}] {:?} ({}s)", check.argv, check.timeout_seconds);
        let start = Instant::now();
        let spawned = command.spawn();
        let receipt = match spawned {
            Err(error) => {
                fs::write(
                    &log_path,
                    format!("Could not start {:?}: {error}\n", check.argv),
                )?;
                Receipt {
                    id: id.clone(),
                    revision: revision.clone(),
                    passed: false,
                    exit_code: None,
                    timed_out: false,
                    log: log_path.to_string_lossy().into_owned(),
                }
            }
            Ok(mut child) => {
                let pending = Pending {
                    id: id.clone(),
                    role: "check".into(),
                    key: id.clone(),
                    revision: revision.clone(),
                    prompt: format!("{:?}", check.argv),
                    pid: Some(child.id()),
                    process_identity: process_identity(child.id()),
                    schema: String::new(),
                };
                atomic(&running, &serde_json::to_vec(&pending)?)?;
                let (status, timed_out) = loop {
                    if let Some(status) = child.try_wait()? {
                        break (status, false);
                    }
                    if start.elapsed() >= Duration::from_secs(check.timeout_seconds) {
                        #[cfg(unix)]
                        {
                            let _ = Command::new("kill")
                                .args(["-KILL", "--", &format!("-{}", child.id())])
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .status();
                        }
                        let _ = child.kill();
                        break (child.wait()?, true);
                    }
                    std::thread::sleep(Duration::from_millis(100));
                };
                fs::remove_file(&running)?;
                Receipt {
                    id: id.clone(),
                    revision: revision.clone(),
                    passed: status.success() && !timed_out,
                    exit_code: status.code(),
                    timed_out,
                    log: log_path.to_string_lossy().into_owned(),
                }
            }
        };
        ensure!(
            head(&state.root)? == revision,
            "check {id} changed HEAD; no evidence can certify another revision"
        );
        clean(&state.root).with_context(|| format!("check {id} changed source inputs"))?;
        ensure!(
            load_bundle(&state.project)? == state.bundle,
            "check {id} changed the approved workflow package"
        );
        eprintln!(
            "[check {id}] {} ({:.1}s)",
            if receipt.passed { "PASS" } else { "FAIL" },
            start.elapsed().as_secs_f64()
        );
        store.event(&json!({"kind":"check", "receipt":receipt}))?;
        state
            .checks
            .retain(|r| r.id != *id || r.revision != revision);
        state.checks.push(receipt.clone());
        store.save(state)?;
        results.push(receipt);
    }
    Ok(results)
}
pub fn passed(receipt: &Receipt) -> bool {
    receipt.passed && receipt.exit_code == Some(0) && !receipt.timed_out
}
pub fn certify(receipts: &[Receipt], required: &[String], revision: &str) -> Result<()> {
    ensure!(
        !required.is_empty(),
        "acceptance requires declared executable checks"
    );
    ensure!(
        receipts.len() == required.len(),
        "unexpected/missing check receipts"
    );
    for id in required {
        let matching: Vec<_> = receipts.iter().filter(|r| r.id == *id).collect();
        ensure!(
            matching.len() == 1,
            "missing or duplicated receipt for {id}"
        );
        let receipt = matching[0];
        ensure!(
            receipt.revision == revision && passed(receipt),
            "{id} did not pass at exact candidate {revision}"
        );
    }
    Ok(())
}
