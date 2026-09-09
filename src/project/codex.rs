//! A small, documented codex-exec adapter. The host, not model prose, owns transitions.
use super::model::text;
use super::store::*;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

pub const REPORT_SCHEMA: &str =
    include_str!("../../dotfiles/.agents/skills/dev-project/references/report.schema.json");
pub const DECISION_SCHEMA: &str =
    include_str!("../../dotfiles/.agents/skills/dev-project/references/decision.schema.json");
const PROTOCOL: &str =
    include_str!("../../dotfiles/.agents/skills/dev-project/references/protocol.md");

pub fn prepare(
    store: &Store,
    state: &mut State,
    role: &str,
    key: &str,
    prompt: &str,
    decision: bool,
) -> Result<()> {
    if state.pending.is_some() {
        return Ok(());
    }
    let id = state.next_id();
    let revision = head(&state.root)?;
    let prompt = format!(
        "MANAGED WORKFLOW\nAttempt: {id}\nTarget: {}\nCandidate at dispatch: {revision}\n\n{prompt}\n\nReturn only the required JSON object. Echo the supplied attempt and target. Builders resolve the resulting revision directly from Git; every other role must retain the supplied candidate. Do not launch subagents or another runner.",
        state.target
    );
    state.pending = Some(Pending {
        id,
        role: role.into(),
        key: key.into(),
        revision,
        prompt,
        pid: None,
        process_identity: None,
        schema: if decision { "decision" } else { "report" }.into(),
    });
    store.save(state)
}

/// A completed on-disk result is consumed after restart without repeating a model turn.
/// An interrupted turn resumes its exact saved session and asks for reconciliation, not blind replay.
pub fn invoke(store: &Store, state: &mut State) -> Result<Value> {
    let pending = state.pending.clone().context("no pending model task")?;
    ensure!(
        !pending_alive(&pending),
        "attempt {} still owns a live process; wait or terminate that exact process before resuming",
        pending.id
    );
    let dir = store.attempt_dir(&pending.id)?;
    let output = dir.join("result.json");
    if dir.join("finished.json").exists() {
        return Ok(parse_result(&read_limited(&output)?));
    }
    let role = crate::agent_roles::load(&pending.role)?;
    let schema = if pending.schema == "decision" {
        DECISION_SCHEMA
    } else {
        REPORT_SCHEMA
    };
    atomic(&dir.join("schema.json"), schema.as_bytes())?;
    let config = crate::load_agent_config()?;
    let mut args = crate::agent_codex_overlay_args(&config)?;
    // Native interactive policy stays unchanged. Managed turns cannot present approval prompts.
    let sandbox = if pending.role == "builder" {
        "workspace-write"
    } else {
        "read-only"
    };
    let instructions = format!(
        "{}\n\n{}\n\nManaged wire protocol:\n{PROTOCOL}",
        role.developer_instructions,
        crate::agent_roles::skill(&pending.role)
    );
    for (key, value) in [
        ("model", json!(role.model)),
        ("model_reasoning_effort", json!(role.model_reasoning_effort)),
        ("sandbox_mode", json!(sandbox)),
        ("approval_policy", json!("never")),
        ("approvals_reviewer", json!("user")),
        ("agents.enabled", json!(false)),
        ("features.multi_agent", json!(false)),
        ("developer_instructions", json!(instructions)),
    ] {
        args.extend(["-c".into(), format!("{key}={value}")]);
    }
    if pending.role == "builder" {
        // A worktree's index may live outside its source root; authorize only its real Git metadata.
        let common = git(
            &state.root,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?;
        args.extend([
            "-c".into(),
            format!("sandbox_workspace_write.writable_roots={}", json!([common])),
        ]);
    }
    args.extend([
        "exec".into(),
        "--strict-config".into(),
        "--json".into(),
        "--output-schema".into(),
        dir.join("schema.json").to_string_lossy().into_owned(),
        "-o".into(),
        output.to_string_lossy().into_owned(),
    ]);
    if let Some(session) = state.sessions.get(&pending.key) {
        args.extend(["resume".into(), session.clone()]);
    }
    args.push("-".into());
    let interrupted = dir.join("events.jsonl").exists();
    if output.exists() {
        fs::remove_file(&output)?;
    }
    let stderr = File::create(dir.join("stderr.log"))?;
    let binary = std::env::var_os("DEV_CODEX_BIN").unwrap_or_else(|| "codex".into());
    let mut child = Command::new(binary)
        .args(&args)
        .current_dir(&state.root)
        .env("DEV_WORKFLOW_MANAGED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(stderr)
        .spawn()
        .context("launch codex exec; the runner paused without changing plan acceptance")?;
    let live = state.pending.as_mut().context("pending task disappeared")?;
    live.pid = Some(child.id());
    live.process_identity = process_identity(child.id());
    store.save(state)?;
    let message = if interrupted {
        format!(
            "{}\n\nThis attempt was interrupted. Inspect current Git state and prior work in this session before acting; recover completed work and produce the requested report without blindly repeating edits or commits.",
            pending.prompt
        )
    } else {
        pending.prompt.clone()
    };
    let stdin_result = child
        .stdin
        .take()
        .context("missing codex stdin")?
        .write_all(message.as_bytes());
    if let Err(e) = stdin_result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(e).context("send Codex input");
    }
    eprintln!(
        "[{}] {} / {} at {}",
        pending.id, pending.role, state.target, pending.revision
    );
    let mut events = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("events.jsonl"))?;
    let stdout = child.stdout.take().context("missing codex stdout")?;
    let mut completed = false;
    let mut failure = None;
    let read_result = (|| -> Result<()> {
        for line in BufReader::new(stdout).lines() {
            let line = line?;
            writeln!(events, "{line}")?;
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match event["type"].as_str() {
                Some("thread.started") => {
                    let id = event["thread_id"]
                        .as_str()
                        .context("thread.started lacks thread_id")?;
                    text(id, "session ID")?;
                    if let Some(old) = state.sessions.get(&pending.key) {
                        ensure!(old == id, "resume returned another session ID");
                    }
                    state.sessions.insert(pending.key.clone(), id.into());
                    store.save(state)?;
                }
                Some("turn.completed") => {
                    completed = true;
                    state.input_tokens += event["usage"]["input_tokens"].as_u64().unwrap_or(0);
                    state.output_tokens += event["usage"]["output_tokens"].as_u64().unwrap_or(0);
                }
                Some("turn.failed") | Some("error") => {
                    failure = Some(event.to_string());
                }
                Some("item.completed") => {
                    if event["item"]["type"].as_str() == Some("command_execution") {
                        let command = event["item"]["command"].as_str().unwrap_or("command");
                        let compact: String = command.chars().take(180).collect();
                        eprintln!(
                            "  {}: {compact}",
                            event["item"]["status"].as_str().unwrap_or("finished")
                        );
                    }
                }
                _ => {}
            }
        }
        Ok(())
    })();
    if read_result.is_err() {
        let _ = child.kill();
    }
    let status = child.wait()?;
    let task = state.pending.as_mut().context("pending task disappeared")?;
    task.pid = None;
    task.process_identity = None;
    store.save(state)?;
    read_result?;
    ensure!(
        status.success() && completed && failure.is_none(),
        "Codex runtime paused: status={status}, completed={completed}, error={:?}. Exact session and in-flight work are preserved in {}",
        failure,
        dir.display()
    );
    let value = parse_result(&read_limited(&output)?);
    atomic(
        &dir.join("finished.json"),
        &serde_json::to_vec(&json!({"exit_success":true,"turn_completed":true}))?,
    )?;
    store.save(state)?;
    Ok(value)
}

fn parse_result(raw: &str) -> Value {
    serde_json::from_str(raw)
        .unwrap_or_else(|error| json!({"protocol_error":error.to_string(),"raw_result":raw}))
}
