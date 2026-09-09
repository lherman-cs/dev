//! Host-managed, resumable project execution. Unrelated toolbox commands stay in main.rs.
mod checks;
mod codex;
mod model;
mod store;

use anyhow::{Context, Result, bail, ensure};
use model::*;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use store::*;

/// Observe declared packages, not conversations or guessed session IDs. This runs
/// outside the interactive planner's sandbox, after that session has finished.
pub fn planning_snapshot() -> Result<BTreeMap<PathBuf, String>> {
    let cwd = std::env::current_dir()?;
    let Ok(root) = git(&cwd, &["rev-parse", "--show-toplevel"]) else {
        return Ok(BTreeMap::new());
    };
    let root = PathBuf::from(root).canonicalize()?;
    let mut packages = BTreeMap::new();
    let plans = root.join("plans");
    if !plans.exists() {
        return Ok(packages);
    }
    for entry in walkdir::WalkDir::new(plans).follow_links(false).into_iter() {
        let entry = entry?;
        if entry.file_type().is_file() && entry.file_name() == "project.json" {
            let project = entry
                .path()
                .parent()
                .context("manifest without parent")?
                .canonicalize()?;
            if let Ok(bundle) = load_bundle(&project) {
                packages.insert(project, digest(&root, &bundle)?);
            }
        }
    }
    Ok(packages)
}
pub fn finish_planning(before: BTreeMap<PathBuf, String>) -> Result<()> {
    let after = planning_snapshot()?;
    let changed: Vec<_> = after
        .iter()
        .filter(|(path, hash)| before.get(*path) != Some(*hash))
        .map(|(path, _)| path.clone())
        .collect();
    match changed.as_slice() {
        [path] => run(Options {
            prompt: vec![path.to_string_lossy().into_owned()],
            check: true,
            status: false,
            approve: None,
            max_turns: None,
        }),
        [] => {
            eprintln!(
                "No new/changed valid execution package was produced. Planning remains separate from execution; no readiness claim was issued."
            );
            Ok(())
        }
        _ => bail!(
            "multiple project packages changed; run dev a project --check <exact-path> for each intended project"
        ),
    }
}

pub struct Options {
    pub prompt: Vec<String>,
    pub check: bool,
    pub status: bool,
    pub approve: Option<String>,
    pub max_turns: Option<u64>,
}
fn locate(words: &[String]) -> Result<(PathBuf, PathBuf)> {
    let cwd = std::env::current_dir()?;
    let root = PathBuf::from(git(&cwd, &["rev-parse", "--show-toplevel"])?).canonicalize()?;
    let plans = root
        .join("plans")
        .canonicalize()
        .context("no plans/ directory; prepare a project with dev a plan first")?;
    let mut found = BTreeSet::new();
    for word in words {
        let candidate = cwd.join(word.trim_matches('`'));
        if let Ok(p) = candidate.canonicalize() {
            if p.is_dir() && p.starts_with(&plans) && p != plans {
                found.insert(p);
            }
        }
    }
    ensure!(
        found.len() == 1,
        "supply one exact project directory: dev a project plans/<project> (not a free-form project name)"
    );
    let project = found.into_iter().next().context("missing project")?;
    // A project cannot smuggle a different worktree/repository into the ownership boundary.
    let owner = PathBuf::from(git(&project, &["rev-parse", "--show-toplevel"])?).canonicalize()?;
    ensure!(
        root == owner,
        "project directory belongs to another Git worktree"
    );
    Ok((root, project))
}
fn digest(root: &Path, bundle: &Bundle) -> Result<String> {
    hash(root, &serde_json::to_vec(bundle)?)
}
fn header(content: &str, key: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let (k, v) = line.split_once(':')?;
        (k.trim() == key).then(|| v.trim().trim_matches('`').to_owned())
    })
}
fn same_plan(root: &Path, project: &Path, file: &str, value: &str) -> bool {
    [root.join(value), project.join(value)]
        .into_iter()
        .any(|p| p.canonicalize().ok() == project.join(file).canonicalize().ok())
}
/// Legacy artifacts are imported only as explicit, reachable historical facts. They
/// never bypass readiness or the final current-revision integration gate.
fn import_legacy(state: &mut State) -> Result<()> {
    for p in state.bundle.manifest.plans.clone() {
        let build_path = state.project.join(format!("{}.build.md", p.id));
        let Ok(build) = fs::read_to_string(build_path) else {
            continue;
        };
        if !header(&build, "Plan")
            .is_some_and(|v| same_plan(&state.root, &state.project, &p.file, &v))
        {
            continue;
        }
        let status = header(&build, "Status").unwrap_or_default();
        if !matches!(status.as_str(), "COMPLETED" | "NO CHANGE" | "NO_CHANGE") {
            continue;
        }
        let candidate = header(&build, "Commit")
            .filter(|v| v != "none")
            .or_else(|| header(&build, "Revision"))
            .or_else(|| header(&build, "Base revision"));
        let Some(candidate) = candidate else {
            continue;
        };
        if exact_commit(&state.root, &candidate).is_err()
            || !ancestor(&state.root, &candidate, &state.last_revision)?
        {
            continue;
        }
        let s = state
            .plans
            .get_mut(&p.id)
            .context("missing legacy plan state")?;
        s.legacy = true;
        s.candidate = Some(state.last_revision.clone());
        if let Some(base) = header(&build, "Base revision") {
            if exact_commit(&state.root, &base).is_ok() && ancestor(&state.root, &base, &candidate)?
            {
                s.base = base;
            }
        }
        let Ok(review) = fs::read_to_string(state.project.join(format!("{}.review.md", p.id)))
        else {
            continue;
        };
        if header(&review, "Verdict").as_deref() == Some("ACCEPTED")
            && header(&review, "Revision").as_deref() == Some(candidate.as_str())
            && header(&review, "Plan")
                .is_some_and(|v| same_plan(&state.root, &state.project, &p.file, &v))
        {
            s.accepted = Some(candidate);
        }
    }
    Ok(())
}
fn accepted_ids(state: &State) -> BTreeSet<String> {
    state
        .bundle
        .manifest
        .plans
        .iter()
        .filter(|p| state.plans.get(&p.id).is_some_and(|s| s.accepted.is_some()))
        .map(|p| p.id.clone())
        .collect()
}
fn select(state: &mut State) -> Result<()> {
    let accepted = accepted_ids(state);
    let mut ready: Vec<_> = state
        .bundle
        .manifest
        .plans
        .iter()
        .filter(|p| !accepted.contains(&p.id) && p.depends_on.iter().all(|d| accepted.contains(d)))
        .collect();
    ready.sort_by(|a, b| {
        let number = |id: &str| {
            id.split('-')
                .next()
                .unwrap_or("0")
                .parse::<u64>()
                .unwrap_or(u64::MAX)
        };
        number(&a.id)
            .cmp(&number(&b.id))
            .then_with(|| a.id.cmp(&b.id))
    });
    if let Some(plan) = ready.first() {
        state.target = plan.id.clone();
        let s = state.plans.get_mut(&plan.id).context("plan has no state")?;
        if s.candidate.is_none() && s.build.is_none() && s.review.is_none() {
            // The next plan starts after its dependencies, not at the whole project's initial HEAD.
            s.base = state.last_revision.clone();
        }
        state.phase = if s.review.as_ref().is_some_and(|r| {
            r.verdict == Verdict::ChangesRequired && r.revision == state.last_revision
        }) {
            Phase::Lead
        } else if s.candidate.is_some() {
            Phase::Review
        } else {
            Phase::Build
        };
        state.instruction =
            "Complete the approved verifiable outcome; preserve binding requirements.".into();
    } else {
        ensure!(
            accepted.len() == state.bundle.manifest.plans.len(),
            "no ready plan in a validated DAG; state needs reconciliation"
        );
        state.target = "@project".into();
        state.phase = Phase::Final;
        state.instruction = "Verify the integrated project against the approved contract, not a new design wish list.".into();
    }
    state.boundary = None;
    Ok(())
}
fn summary(store: &Store, state: &State, status: &str) {
    println!(
        "Project: {}\nStatus: {status}\nRevision: {}\nAccepted: {}/{}\nState: {}\nPackage: {}",
        state.project.display(),
        state.last_revision,
        accepted_ids(state).len(),
        state.bundle.manifest.plans.len(),
        store.dir.join("state.json").display(),
        state.digest
    );
    if state.target != "@project" {
        println!("Plan: {}", state.target);
    }
    if !state.stop_reason.is_empty() {
        println!("Reason: {}", state.stop_reason);
    }
    if !state.instruction.is_empty() {
        println!("Next action: {}", state.instruction);
    }
    println!(
        "Recorded model tokens: {} input / {} output",
        state.input_tokens, state.output_tokens
    );
    if status == "COMPLETED" {
        println!("Final revision: {}", state.last_revision);
        println!(
            "Final evidence: {}",
            state.project.join("project.review.md").display()
        );
        for p in &state.bundle.manifest.plans {
            if let Some(rev) = state.plans.get(&p.id).and_then(|s| s.accepted.as_ref()) {
                println!("  {} — {}", p.id, rev);
            }
        }
    }
}
fn publish(store: &Store, state: &State, report: &Report, phase: Phase) -> Result<()> {
    let suffix = match phase {
        Phase::Build | Phase::Diagnose => "build",
        Phase::Explore => "investigation",
        Phase::Maintain => "proposal",
        _ => "review",
    };
    let path = if report.target == "@project" {
        state.project.join(match phase {
            Phase::Readiness => "readiness.review.md",
            Phase::MaintenanceReview => "maintenance.review.md",
            Phase::Maintain => "maintenance.proposal.md",
            Phase::Explore => "project.investigation.md",
            Phase::Adjudicate => "project.adjudication.md",
            _ => "project.review.md",
        })
    } else {
        state
            .project
            .join(format!("{}.{}.md", report.target, suffix))
    };
    let plan_path = if report.target == "@project" {
        state.project.clone()
    } else {
        state.project.join(&state.bundle.plan(&report.target)?.file)
    };
    let mut body = format!(
        "# {} evidence\nPlan: {}\nAttempt: {}\nRevision: {}\nMode: {phase:?}\nVerdict: {}\n\n{}\n\n",
        suffix,
        plan_path.display(),
        report.attempt,
        report.revision,
        serde_json::to_value(report.verdict)?
            .as_str()
            .unwrap_or("UNKNOWN"),
        report.summary
    );
    if suffix == "build" {
        body.push_str(&format!(
            "Base revision: {}\nCommit: {}\nStatus: {}\n\n",
            state.plans[&report.target].base,
            report.revision,
            serde_json::to_value(report.verdict)?
                .as_str()
                .unwrap_or("UNKNOWN")
        ));
    }
    body.push_str("## Acceptance evidence\n");
    for e in &report.coverage {
        body.push_str(&format!("- {}: {}\n", e.id, e.proof));
    }
    body.push_str("\n## OPEN findings\n");
    for f in &report.findings {
        body.push_str(&format!("\n### {} ({}, owner {})\nRequirement: {}\nEvidence: {}\nImpact: {}\nClosure: {}\nAlternative: {}\nNew evidence: {}\n",
            f.id, f.kind, f.owner, f.requirement, f.evidence, f.impact, f.closure, f.alternative, f.new_evidence));
    }
    body.push_str("\n## Resolutions and responses\n");
    for r in &report.resolutions {
        body.push_str(&format!("- {} {}: {}\n", r.id, r.disposition, r.evidence));
    }
    for r in &report.responses {
        body.push_str(&format!("- {}: {}\n", r.id, r.proof));
    }
    body.push_str("\n## Runner check receipts\n");
    for c in state
        .checks
        .iter()
        .filter(|c| c.revision == report.revision)
    {
        body.push_str(&format!(
            "- {}: {} — {}\n",
            c.id,
            if c.passed { "PASS" } else { "FAIL" },
            c.log
        ));
    }
    body.push_str(&format!(
        "\n## Next action\n{}\n\nAuthoritative structured report: {}\n",
        report.next_action,
        store
            .attempt_dir(&report.attempt)?
            .join("result.json")
            .display()
    ));
    atomic(&path, body.as_bytes())?;
    // Keep readable plan handoffs aligned with the host's scoped final findings.
    if phase == Phase::Final && report.verdict == Verdict::ChangesRequired {
        let owners: BTreeSet<_> = report.findings.iter().map(|f| f.owner.clone()).collect();
        for owner in owners {
            let mut scoped = report.clone();
            scoped.target = owner.clone();
            scoped.findings.retain(|f| f.owner == owner);
            scoped.coverage.retain(|e| {
                state
                    .bundle
                    .plan(&owner)
                    .is_ok_and(|p| p.obligations.contains(&e.id))
            });
            scoped.resolutions.clear();
            publish(store, state, &scoped, Phase::Review)?;
        }
    }
    Ok(())
}
fn promote(store: &Store, state: &mut State) -> Result<()> {
    let next = state
        .proposal
        .clone()
        .context("missing maintenance proposal")?;
    // promotion=true is a write-ahead intent; startup completes interrupted publication idempotently.
    state.promotion = true;
    store.save(state)?;
    for (file, content) in &next.documents {
        if file != &next.manifest.spec {
            atomic(&state.project.join(file), content.as_bytes())?;
        }
    }
    atomic(
        &state.project.join("project.json"),
        &serde_json::to_vec_pretty(&next.manifest)?,
    )?;
    let current = head(&state.root)?;
    let accepted = accepted_ids(state);
    state.maintenance_history.push(json!({
        "previous_digest":state.digest,
        "incomplete_work":state.plans.iter().filter(|(id, s)| !accepted.contains(*id) && (s.build.is_some() || s.review.is_some()))
            .map(|(id, s)| json!({"plan":id,"base":s.base,"candidate":s.candidate,"open_review":s.review,
                "settled_decisions":s.decisions,"failed_approach_evidence":s.evidence_seen})).collect::<Vec<_>>()
    }));
    for p in &next.manifest.plans {
        if !accepted.contains(&p.id) {
            let old = state
                .bundle
                .manifest
                .plans
                .iter()
                .find(|old| old.id == p.id);
            let unchanged = old == Some(p)
                && state.bundle.documents.get(&p.file) == next.documents.get(&p.file);
            if !unchanged || !state.plans.contains_key(&p.id) {
                state.plans.insert(
                    p.id.clone(),
                    PlanState {
                        base: current.clone(),
                        candidate: Some(current.clone()),
                        ..Default::default()
                    },
                );
                state.sessions.remove(&format!("{}:builder", p.id));
                state.sessions.remove(&format!("{}:reviewer", p.id));
            }
        }
    }
    state.bundle = next;
    state.digest = digest(&state.root, &state.bundle)?;
    state.approved = Some(state.digest.clone()); // contract-preserving, independently accepted maintenance only
    state.checks_authorized = Some(state.digest.clone());
    state.proposal = None;
    state.promotion = false;
    state.phase = Phase::Select;
    store.event(&json!({"kind":"maintenance_promoted","digest":state.digest}))?;
    store.save(state)
}
fn context(state: &State, receipts: &[Receipt]) -> Result<String> {
    let active = state.plans.get(&state.target);
    let plan = if state.target == "@project" {
        None
    } else {
        Some(state.bundle.plan(&state.target)?)
    };
    let plan_text = plan.and_then(|p| state.bundle.documents.get(&p.file));
    let reviewed_bundle = if matches!(
        state.phase,
        Phase::Readiness | Phase::Maintain | Phase::MaintenanceReview | Phase::Final
    ) {
        Some(state.proposal.as_ref().unwrap_or(&state.bundle))
    } else {
        None
    };
    let mode = match state.phase {
        Phase::Readiness => "READINESS",
        Phase::Review => {
            if active.is_some_and(|s| s.review.is_some()) {
                "FOLLOWUP"
            } else {
                "INITIAL"
            }
        }
        Phase::Adjudicate => "ADJUDICATE",
        Phase::Final => "FINAL",
        Phase::MaintenanceReview => "MAINTENANCE",
        Phase::Maintain => "MAINTAIN",
        Phase::Build => "IMPLEMENT_OR_REPAIR",
        Phase::Diagnose => "DIAGNOSE",
        Phase::Explore => "INVESTIGATE",
        _ => "DECIDE",
    };
    Ok(format!(
        "Mode: {mode}\nInstruction: {}\n\nAuthoritative context (do not reinterpret these values as permission to broaden the contract):\n{}",
        state.instruction,
        serde_json::to_string_pretty(&json!({
            "root":state.root,"project":state.project,"binding_spec":state.bundle.documents[&state.bundle.manifest.spec],
            "manifest":state.bundle.manifest,"active_plan":plan,"plan_document":plan_text,"plan_state":active,
            "previous_result":state.last,"validated_boundary":state.boundary,"previous_final":state.final_report,
            "check_receipts":receipts,"maintenance_or_readiness_bundle":reviewed_bundle,
            "maintenance_recovery_history":state.maintenance_history,
            "pending_maintenance":state.proposal,
            "legacy_baseline_warning":active.filter(|s| s.legacy).map(|_| "Imported Base revision may be a repair baseline, not the original plan baseline. Recover full obligation coverage from Git and the contract; do not mistake the latest diff for the complete plan.")
        }))?
    ))
}
fn role_and_key(state: &State) -> Result<(&'static str, String)> {
    let result = match state.phase {
        Phase::Readiness => ("reviewer", "@readiness".into()),
        Phase::Build | Phase::Diagnose => ("builder", format!("{}:builder", state.target)),
        Phase::Review => ("reviewer", format!("{}:reviewer", state.target)),
        Phase::Lead => ("orchestrator", "@lead".into()),
        Phase::Explore => ("explorer", format!("@explore:{}", state.sequence)),
        Phase::Adjudicate => ("reviewer", format!("{}:adjudicator", state.target)),
        Phase::Maintain => ("planner", "@maintenance".into()),
        Phase::MaintenanceReview => ("reviewer", "@maintenance_review".into()),
        Phase::Final => ("reviewer", "@final".into()),
        _ => bail!("phase {:?} does not dispatch a model", state.phase),
    };
    Ok(result)
}
fn required_checks(state: &State) -> Result<Vec<String>> {
    match state.phase {
        Phase::Readiness | Phase::MaintenanceReview => {
            Ok(state.bundle.manifest.readiness_checks.clone())
        }
        Phase::Final => Ok(state.bundle.manifest.final_checks.clone()),
        Phase::Review | Phase::Adjudicate => {
            if state.target == "@project" {
                Ok(state.bundle.manifest.final_checks.clone())
            } else {
                Ok(state.bundle.plan(&state.target)?.checks.clone())
            }
        }
        _ => Ok(Vec::new()),
    }
}
fn check_role_verdict(phase: Phase, v: Verdict) -> Result<()> {
    let valid = match phase {
        Phase::Build => matches!(
            v,
            Verdict::Completed
                | Verdict::NoChange
                | Verdict::Blocked
                | Verdict::RequiresReplanning
                | Verdict::Evidence
        ),
        Phase::Diagnose => matches!(
            v,
            Verdict::Evidence
                | Verdict::Completed
                | Verdict::NoChange
                | Verdict::Blocked
                | Verdict::RequiresReplanning
        ),
        Phase::Explore => v == Verdict::Evidence,
        Phase::Maintain => matches!(
            v,
            Verdict::Prepared | Verdict::Blocked | Verdict::RequiresReplanning | Verdict::Evidence
        ),
        _ => matches!(
            v,
            Verdict::Accepted
                | Verdict::ChangesRequired
                | Verdict::Blocked
                | Verdict::RequiresReplanning
        ),
    };
    ensure!(valid, "role cannot return {v:?} in {phase:?}");
    Ok(())
}
fn retire_plan(state: &mut State, id: &str) {
    state.sessions.remove(&format!("{id}:builder"));
    state.sessions.remove(&format!("{id}:reviewer"));
    state.sessions.remove(&format!("{id}:adjudicator"));
}

/// Pure verdict application, after identity/revision/receipt validation. Model output
/// has no direct COMPLETE action; that state is reachable only through FINAL acceptance.
fn apply_report(state: &mut State, report: Report) -> Result<()> {
    let phase = state.phase;
    match phase {
        Phase::Readiness => {
            state.ready = Some(Ready {
                digest: state.digest.clone(),
                revision: report.revision.clone(),
                report: report.clone(),
            });
            state.phase = Phase::Approval;
        }
        Phase::Build | Phase::Diagnose => {
            let s = state
                .plans
                .get_mut(&state.target)
                .context("missing active plan")?;
            s.build = Some(report.clone());
            s.candidate = Some(report.revision.clone());
            match report.verdict {
                Verdict::Blocked | Verdict::RequiresReplanning => {
                    state.phase = Phase::Adjudicate;
                    state
                        .sessions
                        .remove(&format!("{}:adjudicator", state.target));
                }
                Verdict::Evidence => {
                    // A real discriminating result licenses a changed approach; the lead must explain it.
                    ensure!(
                        !report.progress.is_empty(),
                        "diagnosis needs concrete new evidence, not another request to investigate"
                    );
                    let novel = report.progress.iter().any(|e| !s.evidence_seen.contains(e));
                    ensure!(
                        novel,
                        "diagnosis repeated previously recorded evidence; choose a different discriminating question"
                    );
                    s.evidence_seen.extend(report.progress.clone());
                    s.stalled = false;
                    state.phase = Phase::Lead;
                }
                _ => {
                    state.phase = Phase::Review;
                }
            }
            state.boundary = None;
            state.checks.clear(); // code, verification inputs, or toolchain may have changed
        }
        Phase::Review | Phase::Adjudicate => {
            if phase == Phase::Adjudicate && state.target != "@project" {
                if let Some(id) = state
                    .sessions
                    .get(&format!("{}:adjudicator", state.target))
                    .cloned()
                {
                    state
                        .sessions
                        .insert(format!("{}:reviewer", state.target), id);
                }
            }
            if state.target == "@project" {
                // Final boundary adjudication cannot skip the fresh integration owner's verdict.
                state.boundary = if phase == Phase::Adjudicate
                    && matches!(
                        report.verdict,
                        Verdict::Blocked | Verdict::RequiresReplanning
                    ) {
                    Some(report.clone())
                } else {
                    None
                };
                state.phase = if report.verdict == Verdict::Accepted {
                    Phase::Final
                } else {
                    Phase::Lead
                };
            } else {
                let s = state
                    .plans
                    .get_mut(&state.target)
                    .context("missing active plan")?;
                if let Some(old) = &s.review {
                    report.followup(old)?;
                    s.stalled = report.findings.iter().any(|f| {
                        old.findings.iter().any(|o| o.id == f.id)
                            && s.build.as_ref().is_some_and(|b| {
                                b.revision == report.revision
                                    && matches!(b.verdict, Verdict::Completed | Verdict::NoChange)
                                    && b.responses.iter().any(|r| r.id == f.id)
                            })
                    });
                }
                s.review = Some(report.clone());
                match report.verdict {
                    Verdict::Accepted => {
                        s.accepted = Some(report.revision.clone());
                        let id = state.target.clone();
                        retire_plan(state, &id);
                        state.phase = Phase::Select;
                        state.boundary = None;
                    }
                    Verdict::ChangesRequired => {
                        state.phase = Phase::Lead;
                        state.boundary = None;
                    }
                    _ if phase == Phase::Adjudicate => {
                        state.boundary = Some(report.clone());
                        state.phase = Phase::Lead;
                    }
                    _ => {
                        state.phase = Phase::Adjudicate;
                        state
                            .sessions
                            .remove(&format!("{}:adjudicator", state.target));
                    }
                }
            }
        }
        Phase::Explore => {
            ensure!(
                !report.progress.is_empty(),
                "investigation must establish a fact or a concrete unavailable prerequisite"
            );
            if let Some(s) = state.plans.get_mut(&state.target) {
                ensure!(
                    report.progress.iter().any(|e| !s.evidence_seen.contains(e)),
                    "investigation repeated settled evidence"
                );
                s.evidence_seen.extend(report.progress.clone());
                s.stalled = false;
            }
            state.phase = Phase::Lead;
        }
        Phase::Maintain => {
            if report.verdict == Verdict::Prepared {
                let proposal = report.proposal.as_ref().context("missing proposal")?;
                state.proposal = Some(state.bundle.maintenance(proposal, &accepted_ids(state))?);
                state.sessions.remove("@maintenance_review");
                state.phase = Phase::MaintenanceReview;
            } else {
                state.phase = Phase::Lead;
            }
        }
        Phase::MaintenanceReview => {
            if report.verdict == Verdict::Accepted {
                state.promotion = true;
            } else {
                state.phase = Phase::Lead;
            }
        }
        Phase::Final => {
            if let Some(old) = &state.final_report {
                report.followup(old)?;
            }
            state.final_report = Some(report.clone());
            match report.verdict {
                Verdict::Accepted => {
                    ensure!(
                        accepted_ids(state).len() == state.bundle.manifest.plans.len(),
                        "final acceptance cannot skip incomplete plans"
                    );
                    state.phase = Phase::Complete;
                    state.stop_status.clear();
                    state.stop_reason.clear();
                    state.instruction.clear();
                }
                Verdict::ChangesRequired => {
                    let owners: BTreeSet<_> =
                        report.findings.iter().map(|f| f.owner.clone()).collect();
                    ensure!(!owners.is_empty(), "final failure needs an owning plan");
                    for owner in owners {
                        let mut scoped = report.clone();
                        scoped.target = owner.clone();
                        scoped.findings.retain(|f| f.owner == owner);
                        scoped.coverage.retain(|e| {
                            state
                                .bundle
                                .plan(&owner)
                                .is_ok_and(|p| p.obligations.contains(&e.id))
                        });
                        scoped.resolutions.clear();
                        let s = state
                            .plans
                            .get_mut(&owner)
                            .context("final finding has no owning plan")?;
                        s.accepted = None;
                        s.candidate = Some(report.revision.clone());
                        s.review = Some(scoped);
                        s.stalled = false;
                    }
                    // Batch affected owners, then repair them in dependency order without
                    // spending a fresh final-review turn merely to rediscover another known failure.
                    select(state)?;
                }
                _ => {
                    state.phase = Phase::Adjudicate;
                    state.sessions.remove("@project:adjudicator");
                }
            }
        }
        _ => bail!("unexpected report in phase {phase:?}"),
    }
    state.last_revision = report.revision.clone();
    state.last = Some(report);
    Ok(())
}
fn apply_decision(state: &mut State, decision: &Decision) -> Result<()> {
    if let Some(s) = state.plans.get_mut(&state.target) {
        if !decision.settled_decision.trim().is_empty() {
            s.decisions.push(format!(
                "{} — {}",
                decision.settled_decision, decision.evidence
            ));
            if s.decisions.len() > 32 {
                s.decisions.remove(0);
            }
        }
    }
    state.instruction = decision.instruction.clone();
    match decision.action {
        Action::Build | Action::Diagnose => {
            ensure!(
                state.target != "@project",
                "implementation needs an owning numbered plan"
            );
            if decision.replace_worker {
                state.sessions.remove(&format!("{}:builder", state.target));
            }
            state.phase = if decision.action == Action::Build {
                Phase::Build
            } else {
                Phase::Diagnose
            };
        }
        Action::Review => {
            state.phase = if state.target == "@project" {
                Phase::Final
            } else {
                Phase::Review
            };
        }
        Action::Investigate => {
            state.phase = Phase::Explore;
        }
        Action::Adjudicate => {
            state
                .sessions
                .remove(&format!("{}:adjudicator", state.target));
            state.phase = Phase::Adjudicate;
        }
        Action::Maintain => {
            state.phase = Phase::Maintain;
            state.target = "@project".into();
        }
        Action::StopBlocked | Action::StopReplan => {
            state.phase = Phase::Stopped;
            state.stop_status = if decision.action == Action::StopBlocked {
                "BLOCKED"
            } else {
                "REQUIRES REPLANNING"
            }
            .into();
            state.stop_reason = decision.evidence.clone();
        }
    }
    Ok(())
}

fn approve(store: &Store, state: &mut State, options: &Options) -> Result<bool> {
    let ready = state.ready.as_ref().context("missing readiness record")?;
    ensure!(
        ready.digest == state.digest && ready.revision == head(&state.root)?,
        "readiness is stale; rerun --check at this package/revision"
    );
    if ready.report.verdict != Verdict::Accepted {
        summary(store, state, "NOT READY");
        bail!(
            "readiness review did not accept the package; resolve its concrete findings with dev a plan, not a production builder"
        );
    }
    if options.check {
        summary(store, state, "READY — NOT STARTED");
        println!(
            "Approve this snapshot when starting: dev a project --approve {} {}",
            state.digest,
            state.project.display()
        );
        return Ok(false);
    }
    if state.approved.as_deref() == Some(state.digest.as_str()) {
        state.phase = Phase::Select;
        return Ok(true);
    }
    if let Some(value) = &options.approve {
        ensure!(
            value == &state.digest,
            "approval digest mismatch; current package is {}",
            state.digest
        );
    } else {
        ensure!(
            io::stdin().is_terminal(),
            "explicit approval needed: inspect {} and run with --approve {}",
            state.project.display(),
            state.digest
        );
        eprintln!(
            "\nReady package: {}\nContract: {}\nDigest: {}",
            state.bundle.manifest.name,
            state.project.join("spec.md").display(),
            state.digest
        );
        eprintln!(
            "The runner executes these approved verification commands as your OS user (not inside the Codex sandbox):"
        );
        for c in &state.bundle.manifest.checks {
            eprintln!(
                "  {}: {:?} [cwd={}, timeout={}s]",
                c.id, c.argv, c.cwd, c.timeout_seconds
            );
        }
        eprint!("Approve this contract/plan snapshot and begin managed execution? Type yes: ");
        io::stderr().flush()?;
        let mut answer = String::new();
        io::stdin().read_line(&mut answer)?;
        if answer.trim() != "yes" {
            summary(store, state, "READY — NOT STARTED");
            return Ok(false);
        }
    }
    state.approved = Some(state.digest.clone());
    state.phase = Phase::Select;
    store.event(
        &json!({"kind":"human_approval","digest":state.digest,"revision":state.last_revision}),
    )?;
    store.save(state)?;
    Ok(true)
}
/// Host checks can execute repository code outside the Codex sandbox. Authorize the
/// exact declared snapshot before even readiness probes run, not only before building.
fn authorize_checks(store: &Store, state: &mut State, options: &Options) -> Result<()> {
    if state.checks_authorized.as_deref() == Some(state.digest.as_str()) {
        return Ok(());
    }
    if options.approve.as_deref() != Some(state.digest.as_str()) {
        ensure!(
            io::stdin().is_terminal(),
            "host checks need explicit snapshot authorization. Inspect `dev a project --status {}` then use `--check --approve {}`; --check never starts implementation",
            state.project.display(),
            state.digest
        );
        eprintln!(
            "\nHost verification commands for package {} (run as your OS user, outside the Codex sandbox):",
            state.digest
        );
        for c in &state.bundle.manifest.checks {
            eprintln!(
                "  {}: {:?} [cwd={}, timeout={}s]",
                c.id, c.argv, c.cwd, c.timeout_seconds
            );
        }
        eprint!("Authorize this exact command/package snapshot for verification? Type yes: ");
        io::stderr().flush()?;
        let mut answer = String::new();
        io::stdin().read_line(&mut answer)?;
        ensure!(
            answer.trim() == "yes",
            "verification not authorized; project remains unstarted"
        );
    }
    state.checks_authorized = Some(state.digest.clone());
    store.event(&json!({"kind":"check_authorization","digest":state.digest}))?;
    store.save(state)
}
fn completion_ready(state: &State, current: &str) -> Result<()> {
    ensure!(
        state.approved.as_deref() == Some(state.digest.as_str()),
        "final package is not approved"
    );
    ensure!(
        accepted_ids(state).len() == state.bundle.manifest.plans.len(),
        "an active plan is incomplete"
    );
    let report = state
        .final_report
        .as_ref()
        .context("missing independent final review")?;
    ensure!(
        report.verdict == Verdict::Accepted
            && report.revision == current
            && state.last_revision == current,
        "final evidence is stale or rejected"
    );
    ensure!(
        report.findings.is_empty(),
        "final evidence contains OPEN findings"
    );
    for id in &state.bundle.manifest.final_checks {
        ensure!(
            state
                .final_receipts
                .iter()
                .any(|r| r.id == *id && r.revision == current && checks::passed(r)),
            "missing passing final receipt for {id}"
        );
    }
    Ok(())
}
fn validate_result(state: &State, report: &Report, receipts: &[Receipt]) -> Result<()> {
    let pending = state.pending.as_ref().context("no task identity")?;
    let current = head(&state.root)?;
    exact_commit(&state.root, &current)?;
    // Only a builder may advance the source candidate, and it must extend the original history.
    if pending.role == "builder" {
        ensure!(
            ancestor(&state.root, &pending.revision, &current)?,
            "builder rewrote or switched candidate history"
        );
        if report.verdict == Verdict::NoChange {
            ensure!(current == pending.revision, "NO_CHANGE advanced HEAD");
        }
        clean(&state.root).context("before a handoff, reconcile task-owned partial edits into an explicit candidate; never discard unrelated work")?;
    } else {
        ensure!(
            current == pending.revision,
            "non-builder changed candidate HEAD"
        );
        clean(&state.root)?;
    }
    ensure!(
        load_bundle(&state.project)? == state.bundle,
        "worker modified the sealed contract/plan package"
    );
    let bundle = if state.phase == Phase::MaintenanceReview {
        state
            .proposal
            .as_ref()
            .context("missing proposed package")?
    } else {
        &state.bundle
    };
    report.validate(bundle, &pending.id, &state.target, &current)?;
    check_role_verdict(state.phase, report.verdict)?;
    if report.verdict == Verdict::Accepted {
        checks::certify(receipts, &required_checks(state)?, &current)
            .context("ACCEPTED is invalid: required runner evidence is missing, failed, or targets another revision")?;
    }
    if pending.role == "builder" {
        if let Some(old) = state
            .plans
            .get(&state.target)
            .and_then(|p| p.review.as_ref())
        {
            if matches!(report.verdict, Verdict::Completed | Verdict::NoChange) {
                for f in &old.findings {
                    ensure!(
                        report.responses.iter().any(|r| r.id == f.id),
                        "missing builder fix/rebuttal response for {}",
                        f.id
                    );
                }
            }
        }
    }
    if matches!(state.phase, Phase::Review | Phase::Adjudicate) {
        if let Some(old) = state
            .plans
            .get(&state.target)
            .and_then(|p| p.review.as_ref())
        {
            report.followup(old)?;
        }
    }
    if state.phase == Phase::Final {
        if let Some(old) = &state.final_report {
            report.followup(old)?;
        }
    }
    Ok(())
}
fn acknowledge(store: &Store, state: &mut State, result: &Value) -> Result<()> {
    let pending = state
        .pending
        .as_ref()
        .context("no pending acknowledgment")?;
    store.event(&json!({"kind":"transition","attempt":pending.id,"role":pending.role,"next_phase":state.phase,"result":result}))?;
    state.pending = None;
    store.save(state)
}
fn snapshot_update(store: &Store, state: &mut State, new_bundle: Bundle) -> Result<()> {
    // Explicit --check can stage a newly user/planner-edited package. Code is never reset.
    // Preserve acceptance only if the binding contract and that exact plan are unchanged.
    let binding_same = state.bundle.binding_bytes()? == new_bundle.binding_bytes()?;
    let current = head(&state.root)?;
    let mut plans = BTreeMap::new();
    for p in &new_bundle.manifest.plans {
        let same = binding_same
            && state.bundle.manifest.plans.iter().find(|o| o.id == p.id) == Some(p)
            && state.bundle.documents.get(&p.file) == new_bundle.documents.get(&p.file);
        let s = if same {
            state.plans.get(&p.id).cloned().unwrap_or_default()
        } else {
            PlanState {
                base: current.clone(),
                candidate: Some(current.clone()),
                ..Default::default()
            }
        };
        plans.insert(p.id.clone(), s);
    }
    state.bundle = new_bundle;
    state.digest = digest(&state.root, &state.bundle)?;
    state.plans = plans;
    state.approved = None;
    state.checks_authorized = None;
    state.ready = None;
    state.sessions.clear();
    state.final_report = None;
    state.final_receipts.clear();
    state.last = None;
    state.boundary = None;
    state.proposal = None;
    state.phase = Phase::Readiness;
    state.target = "@project".into();
    state.checks.clear();
    state.last_revision = current;
    store.event(&json!({"kind":"explicit_package_update","digest":state.digest,"binding_unchanged":binding_same}))?;
    store.save(state)
}

pub fn run(options: Options) -> Result<()> {
    ensure!(
        cfg!(unix),
        "managed project execution requires Unix process/liveness support; other toolbox commands remain available"
    );
    ensure!(
        std::env::var_os("DEV_WORKFLOW_MANAGED").is_none(),
        "managed workers cannot recursively start a project runner"
    );
    let (root, project) = locate(&options.prompt)?;
    let store = Store::open(&root, &project, !options.status)?;
    if options.status {
        match store.load()? {
            Some(s) => summary(&store, &s, &format!("{:?}", s.phase)),
            None => {
                let bundle = load_bundle(&project)?;
                println!(
                    "Project: {}\nStatus: NOT INITIALIZED\nPackage: {}",
                    project.display(),
                    digest(&root, &bundle)?
                );
                for c in &bundle.manifest.checks {
                    println!(
                        "Check {}: {:?} [cwd={}, timeout={}s]",
                        c.id, c.argv, c.cwd, c.timeout_seconds
                    );
                }
            }
        }
        return Ok(());
    }
    let mut state = match store.load()? {
        Some(state) => state,
        None => {
            clean(&root)?;
            let bundle = load_bundle(&project).context("missing/invalid execution package; adopt legacy plans with dev a plan before invoking the enforced runner")?;
            let mut state = State::new(root.clone(), project.clone(), bundle)?;
            import_legacy(&mut state)?;
            store.save(&state)?;
            state
        }
    };
    ensure!(
        state.root == root && state.project == project,
        "runner state belongs to another canonical worktree/project"
    );
    if state.promotion {
        promote(&store, &mut state)?;
    }
    let live_bundle = load_bundle(&project)?;
    if live_bundle != state.bundle {
        ensure!(
            options.check && state.pending.is_none(),
            "approved package changed outside maintenance; use dev a project --check <path> to explicitly stage/review a new snapshot"
        );
        snapshot_update(&store, &mut state, live_bundle)?;
    }
    let current = head(&root)?;
    ensure!(
        ancestor(&root, &state.last_revision, &current)?,
        "Git history diverged from runner state; reconcile the designated worktree before continuing"
    );
    if state.pending.as_ref().is_some_and(pending_alive) {
        bail!("the recorded worker is still live; no duplicate attempt was launched");
    }
    if state.pending.is_none() {
        clean(&root)?;
    }
    if state.last_revision != current && state.pending.is_none() {
        // New external descendant commits need current-revision review, not historical re-audits.
        state.last_revision = current.clone();
        state.final_report = None;
        if state.approved.is_some() {
            state.phase = Phase::Select;
        } else {
            state.ready = None;
            state.phase = Phase::Readiness;
        }
    }
    if options.check && state.pending.is_none() {
        state.phase = Phase::Readiness;
        state.target = "@project".into();
        state.sessions.remove("@readiness");
    }
    if let Some(value) = &options.approve {
        ensure!(
            value == &state.digest,
            "approval digest mismatch; package digest is {}",
            state.digest
        );
    }
    if state.phase == Phase::Stopped {
        state.phase = Phase::Lead;
        state.instruction = "Explicitly resumed after a stop. Recheck the recorded prerequisite/conflict against current evidence; recover if a conforming route is now available.".into();
        state.stop_status.clear();
        state.stop_reason.clear();
    }
    // Reuse receipts within this invocation only; a restart may have a different environment.
    state.checks.clear();
    store.save(&state)?;
    let mut turns = 0;
    let mut invalid_reports = 0;
    let result = (|| -> Result<()> {
        loop {
            match state.phase {
                Phase::Approval => {
                    if !approve(&store, &mut state, &options)? {
                        return Ok(());
                    }
                    store.save(&state)?;
                    continue;
                }
                Phase::Select => {
                    select(&mut state)?;
                    store.save(&state)?;
                    continue;
                }
                Phase::Complete => {
                    completion_ready(&state, &head(&root)?)?;
                    clean(&root)?;
                    summary(&store, &state, "COMPLETED");
                    return Ok(());
                }
                Phase::Stopped => {
                    summary(&store, &state, &state.stop_status);
                    return Ok(());
                }
                _ => {}
            }
            if state.phase != Phase::Readiness {
                ensure!(
                    state.approved.as_deref() == Some(state.digest.as_str()),
                    "execution requires approval of the exact package"
                );
            }
            if options.max_turns.is_some_and(|max| turns >= max) {
                summary(&store, &state, "PAUSED — USER TURN BUDGET");
                return Ok(());
            }
            let required = required_checks(&state)?;
            // No check is run in a dirty interrupted builder tree; that builder recovers its own attempt.
            let receipts = if required.is_empty() {
                Vec::new()
            } else {
                authorize_checks(&store, &mut state, &options)?;
                checks::run(&store, &mut state, &required)?
            };
            let phase = state.phase;
            let (role, key) = role_and_key(&state)?;
            let prompt = context(&state, &receipts)?;
            codex::prepare(
                &store,
                &mut state,
                role,
                &key,
                &prompt,
                phase == Phase::Lead,
            )?;
            turns += 1;
            let mut service_failures = 0;
            let value = loop {
                match codex::invoke(&store, &mut state) {
                    Ok(value) => break value,
                    Err(error) => {
                        let reason = format!("{error:#}").to_lowercase();
                        let transient = [
                            "temporar",
                            "overload",
                            "rate limit",
                            "429",
                            "503",
                            "502",
                            "connection reset",
                            "transport",
                            "timed out",
                        ]
                        .iter()
                        .any(|word| reason.contains(word));
                        if !transient || service_failures >= 2 {
                            return Err(error);
                        }
                        service_failures += 1;
                        eprintln!(
                            "Transient model service failure; retrying the saved attempt/session after backoff."
                        );
                        std::thread::sleep(std::time::Duration::from_secs(
                            1_u64 << service_failures,
                        ));
                    }
                }
            };
            let mut accepted_report = None;
            let transition = (|| -> Result<State> {
                let mut next = state.clone();
                if phase == Phase::Lead {
                    let decision: Decision = serde_json::from_value(value.clone())
                        .context("invalid orchestrator decision")?;
                    let pending = state.pending.as_ref().context("missing decision attempt")?;
                    ensure!(
                        head(&root)? == pending.revision,
                        "orchestrator changed source revision"
                    );
                    clean(&root)?;
                    ensure!(
                        load_bundle(&project)? == state.bundle,
                        "orchestrator changed the sealed package"
                    );
                    decision.validate(
                        &pending.id,
                        &state.target,
                        state.plans.get(&state.target).is_some_and(|s| s.stalled),
                        state.boundary.as_ref().map(|r| r.verdict),
                    )?;
                    if let Some(plan_state) = next.plans.get_mut(&state.target) {
                        let tree = git(&root, &["rev-parse", "HEAD^{tree}"])?;
                        let open: Vec<_> = plan_state
                            .review
                            .as_ref()
                            .map(|r| r.findings.iter().map(|f| (&f.id, &f.closure)).collect())
                            .unwrap_or_default();
                        let route = hash(
                            &root,
                            &serde_json::to_vec(&(
                                decision.action,
                                &decision.instruction,
                                tree,
                                open,
                                &plan_state.evidence_seen,
                            ))?,
                        )?;
                        ensure!(
                            !plan_state.routes.contains(&route),
                            "this unchanged recovery action already ran without new evidence; choose a different route"
                        );
                        plan_state.routes.push(route);
                    }
                    apply_decision(&mut next, &decision)?;
                } else {
                    let report: Report =
                        serde_json::from_value(value.clone()).context("invalid agent report")?;
                    validate_result(&state, &report, &receipts)?;
                    if phase == Phase::Final && report.verdict == Verdict::Accepted {
                        next.final_receipts = receipts.clone();
                    }
                    apply_report(&mut next, report.clone())?;
                    accepted_report = Some(report);
                }
                Ok(next)
            })();
            if let Err(error) = &transition {
                // This is output correction, not a failed engineering repair or a plan defect.
                // Source changes remain intact and the same worker session is retained.
                invalid_reports += 1;
                store.event(&json!({"kind":"invalid_result","attempt":state.pending.as_ref().map(|p| &p.id),"reason":format!("{error:#}")}))?;
                state.phase = phase;
                state.instruction = format!(
                    "Correct the previous handoff/decision: {error:#}. Reconcile actual Git/evidence. Do not repeat completed implementation or invent evidence to fill fields."
                );
                state.pending = None;
                store.save(&state)?;
                ensure!(
                    invalid_reports < 3,
                    "structured-output protocol could not be recovered; PAUSED with source and sessions preserved (not a rejected plan): {error:#}"
                );
                continue;
            }
            let next = transition?;
            if let Some(report) = &accepted_report {
                publish(&store, &state, report, phase)?;
            }
            state = next;
            invalid_reports = 0;
            acknowledge(&store, &mut state, &value)?;
            if state.promotion {
                promote(&store, &mut state)?;
            }
            eprintln!(
                "[project] accepted {}/{}; next {:?} ({})",
                accepted_ids(&state).len(),
                state.bundle.manifest.plans.len(),
                state.phase,
                state.target
            );
        }
    })();
    if let Err(error) = &result {
        // A runner/service interruption is not a terminal technical verdict.
        store.event(
            &json!({"kind":"runtime_pause","phase":state.phase,"reason":format!("{error:#}")}),
        )?;
        store.save(&state)?;
        eprintln!(
            "Project paused; run the same dev a project command to reconcile/resume. State: {}",
            store.dir.join("state.json").display()
        );
    }
    result
}

#[cfg(test)]
mod tests;
