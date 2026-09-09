use super::*;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);
struct Repo(PathBuf);
impl Repo {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "dev-workflow-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "workflow@example.invalid"],
            vec!["config", "user.name", "Workflow Test"],
        ] {
            assert!(
                Command::new("git")
                    .arg("-C")
                    .arg(&path)
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        fs::write(path.join("source.txt"), "baseline\n").unwrap();
        git(&path, &["add", "source.txt"]).unwrap();
        git(&path, &["commit", "-qm", "baseline"]).unwrap();
        Self(path.canonicalize().unwrap())
    }
    fn state(&self) -> State {
        State::new(self.0.clone(), self.0.join("plans/test"), bundle()).unwrap()
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn bundle() -> Bundle {
    Bundle {
        manifest: Manifest {
            version: 1,
            name: "test project".into(),
            spec: "spec.md".into(),
            obligations: vec![Obligation {
                id: "O1".into(),
                text: "Required behavior".into(),
            }],
            plans: vec![Plan {
                id: "01-behavior".into(),
                file: "01-behavior.md".into(),
                depends_on: vec![],
                obligations: vec!["O1".into()],
                checks: vec!["C1".into()],
            }],
            checks: vec![Check {
                id: "C1".into(),
                argv: vec!["true".into()],
                cwd: ".".into(),
                timeout_seconds: 30,
            }],
            readiness_checks: vec!["C1".into()],
            final_checks: vec!["C1".into()],
        },
        documents: BTreeMap::from([
            ("spec.md".into(), "Binding contract".into()),
            ("01-behavior.md".into(), "Verifiable outcome".into()),
        ]),
    }
}
fn finding() -> Finding {
    Finding {
        id: "R1".into(),
        owner: "01-behavior".into(),
        kind: "correctness".into(),
        requirement: "O1".into(),
        evidence: "source::close returns before cleanup".into(),
        impact: "required resource is leaked".into(),
        closure: "failure path releases owned resource; regression passes".into(),
        alternative: String::new(),
        new_evidence: String::new(),
    }
}
fn report(revision: &str, verdict: Verdict) -> Report {
    Report {
        attempt: "attempt_000001".into(),
        target: "01-behavior".into(),
        revision: revision.into(),
        verdict,
        summary: "Concrete evidence".into(),
        coverage: vec![Evidence {
            id: "O1".into(),
            proof: "executed regression and inspected ownership".into(),
        }],
        findings: if verdict == Verdict::ChangesRequired {
            vec![finding()]
        } else {
            vec![]
        },
        resolutions: vec![],
        responses: vec![],
        progress: vec!["reproducer distinguishes cleanup ownership".into()],
        next_action: "Verify the affected obligation".into(),
        boundary: None,
        proposal: None,
    }
}
fn decision(action: Action) -> Decision {
    Decision {
        attempt: "attempt_000001".into(),
        target: "01-behavior".into(),
        action,
        instruction: "Discriminate the two causal explanations".into(),
        evidence: "the failure persisted after the claimed repair".into(),
        settled_decision: String::new(),
        replace_worker: false,
    }
}
#[test]
fn valid_bundle_passes() {
    bundle().validate().unwrap();
}
#[test]
fn missing_dependency_fails() {
    let mut b = bundle();
    b.manifest.plans[0].depends_on.push("02-missing".into());
    assert!(b.validate().is_err());
}
#[test]
fn self_cycle_fails() {
    let mut b = bundle();
    b.manifest.plans[0].depends_on.push("01-behavior".into());
    assert!(b.validate().is_err());
}
#[test]
fn mutual_cycle_fails() {
    let mut b = two_plans();
    b.manifest.plans[0].depends_on.push("02-integration".into());
    b.manifest.plans[1].depends_on.push("01-behavior".into());
    assert!(b.validate().is_err());
}
#[test]
fn uncovered_obligation_fails() {
    let mut b = bundle();
    b.manifest.obligations.push(Obligation {
        id: "O2".into(),
        text: "forgotten work".into(),
    });
    assert!(b.validate().is_err());
}
#[test]
fn duplicate_obligation_owner_fails() {
    let mut b = two_plans();
    b.manifest.plans[1].obligations.push("O1".into());
    assert!(b.validate().is_err());
}
#[test]
fn missing_check_fails() {
    let mut b = bundle();
    b.manifest.plans[0].checks = vec!["missing".into()];
    assert!(b.validate().is_err());
}
#[test]
fn zero_timeout_fails() {
    let mut b = bundle();
    b.manifest.checks[0].timeout_seconds = 0;
    assert!(b.validate().is_err());
}
#[test]
fn traversal_and_absolute_check_cwd_fail() {
    for cwd in ["../elsewhere", "/etc"] {
        let mut b = bundle();
        b.manifest.checks[0].cwd = cwd.into();
        assert!(b.validate().is_err());
    }
}
#[test]
fn missing_final_verification_fails() {
    let mut b = bundle();
    b.manifest.final_checks.clear();
    assert!(b.validate().is_err());
}
#[test]
fn report_identity_is_exact() {
    let r = report("abc", Verdict::Accepted);
    assert!(r.validate(&bundle(), "another", &r.target, "abc").is_err());
    assert!(r.validate(&bundle(), &r.attempt, &r.target, "def").is_err());
}
#[test]
fn accepted_report_needs_complete_coverage() {
    let mut r = report("abc", Verdict::Accepted);
    r.coverage.clear();
    assert!(r.validate(&bundle(), &r.attempt, &r.target, "abc").is_err());
}
#[test]
fn accepted_report_cannot_hide_open_findings() {
    let mut r = report("abc", Verdict::Accepted);
    r.findings.push(finding());
    assert!(r.validate(&bundle(), &r.attempt, &r.target, "abc").is_err());
}
#[test]
fn repair_verdict_requires_actionable_findings() {
    let mut r = report("abc", Verdict::ChangesRequired);
    r.findings.clear();
    assert!(r.validate(&bundle(), &r.attempt, &r.target, "abc").is_err());
}
#[test]
fn design_blocker_requires_real_alternative() {
    let mut r = report("abc", Verdict::ChangesRequired);
    r.findings[0].kind = "design".into();
    assert!(r.validate(&bundle(), &r.attempt, &r.target, "abc").is_err());
    r.findings[0].alternative =
        "reuse the existing owner, eliminating a competing state machine".into();
    r.validate(&bundle(), &r.attempt, &r.target, "abc").unwrap();
}
#[test]
fn finding_cannot_silently_disappear() {
    let old = report("a", Verdict::ChangesRequired);
    let new = report("b", Verdict::Accepted);
    assert!(new.followup(&old).is_err());
}
#[test]
fn counterevidence_can_close_a_false_finding() {
    let old = report("a", Verdict::ChangesRequired);
    let mut new = report("a", Verdict::Accepted);
    new.resolutions.push(Resolution {
        id: "R1".into(),
        disposition: "REFUTED".into(),
        evidence: "actual caller transfers ownership before this path".into(),
    });
    new.followup(&old).unwrap();
}
#[test]
fn changed_closure_requires_new_evidence() {
    let old = report("a", Verdict::ChangesRequired);
    let mut new = old.clone();
    new.findings[0].closure = "different outcome".into();
    assert!(new.followup(&old).is_err());
    new.findings[0].new_evidence =
        "new reachable caller disproves original closure criterion".into();
    new.followup(&old).unwrap();
}
#[test]
fn new_repair_finding_requires_material_evidence() {
    let old = report("a", Verdict::Accepted);
    let mut new = report("b", Verdict::ChangesRequired);
    assert!(new.followup(&old).is_err());
    new.findings[0].new_evidence = "repair made this previously unreachable path reachable".into();
    new.followup(&old).unwrap();
}
#[test]
fn there_is_no_model_complete_action() {
    let mut v = serde_json::to_value(decision(Action::Build)).unwrap();
    v["action"] = json!("COMPLETE");
    assert!(serde_json::from_value::<Decision>(v).is_err());
}
#[test]
fn unvalidated_boundary_cannot_stop_execution() {
    for action in [Action::StopBlocked, Action::StopReplan] {
        assert!(
            decision(action)
                .validate("attempt_000001", "01-behavior", false, None)
                .is_err()
        );
    }
    decision(Action::StopBlocked)
        .validate(
            "attempt_000001",
            "01-behavior",
            false,
            Some(Verdict::Blocked),
        )
        .unwrap();
}
#[test]
fn stalled_repair_requires_changed_recovery_strategy() {
    assert!(
        decision(Action::Build)
            .validate("attempt_000001", "01-behavior", true, None)
            .is_err()
    );
    for action in [Action::Diagnose, Action::Investigate, Action::Adjudicate] {
        decision(action)
            .validate("attempt_000001", "01-behavior", true, None)
            .unwrap();
    }
}
#[test]
fn builder_cannot_accept_itself() {
    assert!(check_role_verdict(Phase::Build, Verdict::Accepted).is_err());
}
#[test]
fn unknown_report_fields_fail_closed() {
    let mut v = serde_json::to_value(report("a", Verdict::Accepted)).unwrap();
    v["trust_me"] = json!(true);
    assert!(serde_json::from_value::<Report>(v).is_err());
}
#[test]
fn two_repairs_are_not_a_terminal_condition() {
    let repo = Repo::new();
    let mut s = repo.state();
    s.target = "01-behavior".into();
    for _ in 0..20 {
        s.phase = Phase::Review;
        let r = report(&s.last_revision, Verdict::ChangesRequired);
        apply_report(&mut s, r).unwrap();
        assert_eq!(s.phase, Phase::Lead);
        assert!(s.stop_status.is_empty());
    }
}
#[test]
fn adjudicator_becomes_the_new_evaluator() {
    let repo = Repo::new();
    let mut s = repo.state();
    s.target = "01-behavior".into();
    s.phase = Phase::Adjudicate;
    s.sessions
        .insert("01-behavior:reviewer".into(), "old".into());
    s.sessions
        .insert("01-behavior:adjudicator".into(), "independent".into());
    let r = report(&s.last_revision, Verdict::ChangesRequired);
    apply_report(&mut s, r).unwrap();
    assert_eq!(s.sessions["01-behavior:reviewer"], "independent");
}
#[test]
fn accepted_plan_advances_without_an_extra_model_turn() {
    let repo = Repo::new();
    let mut s = repo.state();
    s.target = "01-behavior".into();
    s.phase = Phase::Review;
    let r = report(&s.last_revision, Verdict::Accepted);
    apply_report(&mut s, r).unwrap();
    assert_eq!(s.phase, Phase::Select);
    select(&mut s).unwrap();
    assert_eq!(s.phase, Phase::Final);
}
#[test]
fn final_acceptance_requires_actual_receipts() {
    let repo = Repo::new();
    let mut s = repo.state();
    s.approved = Some(s.digest.clone());
    s.plans.get_mut("01-behavior").unwrap().accepted = Some(s.last_revision.clone());
    let mut r = report(&s.last_revision, Verdict::Accepted);
    r.target = "@project".into();
    s.final_report = Some(r);
    assert!(completion_ready(&s, &s.last_revision).is_err());
    s.final_receipts.push(Receipt {
        id: "C1".into(),
        revision: s.last_revision.clone(),
        passed: true,
        exit_code: Some(0),
        timed_out: false,
        log: "recorded.log".into(),
    });
    completion_ready(&s, &s.last_revision).unwrap();
    assert!(completion_ready(&s, "another_revision").is_err());
    s.final_receipts[0].passed = false;
    assert!(completion_ready(&s, &s.last_revision).is_err());
}
fn two_plans() -> Bundle {
    let mut b = bundle();
    b.manifest.obligations.push(Obligation {
        id: "O2".into(),
        text: "integrated behavior".into(),
    });
    b.manifest.plans.push(Plan {
        id: "02-integration".into(),
        file: "02-integration.md".into(),
        depends_on: vec![],
        obligations: vec!["O2".into()],
        checks: vec!["C1".into()],
    });
    b.documents
        .insert("02-integration.md".into(), "integrated slice".into());
    b
}
#[test]
fn final_failure_only_reopens_its_owner() {
    let repo = Repo::new();
    let mut s = State::new(repo.0.clone(), repo.0.join("plans/test"), two_plans()).unwrap();
    for p in s.plans.values_mut() {
        p.accepted = Some(s.last_revision.clone());
    }
    s.target = "@project".into();
    s.phase = Phase::Final;
    let mut r = report(&s.last_revision, Verdict::ChangesRequired);
    r.target = "@project".into();
    apply_report(&mut s, r).unwrap();
    assert!(s.plans["01-behavior"].accepted.is_none());
    assert!(s.plans["02-integration"].accepted.is_some());
    assert_eq!(s.target, "01-behavior");
    assert_eq!(s.phase, Phase::Lead);
}
fn proposal(b: &Bundle) -> Proposal {
    Proposal {
        rationale: "correct sequencing without altering outcomes".into(),
        plans: b.manifest.plans.clone(),
        documents: b
            .documents
            .iter()
            .filter(|(name, _)| name.as_str() != "spec.md")
            .map(|(name, text)| Document {
                file: name.clone(),
                text: text.clone(),
            })
            .collect(),
    }
}
#[test]
fn maintenance_can_change_guidance_but_not_accepted_work() {
    let b = bundle();
    let mut p = proposal(&b);
    p.documents[0].text = "better implementation guidance".into();
    b.maintenance(&p, &BTreeSet::new()).unwrap();
    assert!(
        b.maintenance(&p, &BTreeSet::from(["01-behavior".into()]))
            .is_err()
    );
}
#[test]
fn maintenance_cannot_smuggle_in_new_binding_spec() {
    let b = bundle();
    let mut p = proposal(&b);
    p.documents.push(Document {
        file: "spec.md".into(),
        text: "weakened contract".into(),
    });
    assert!(b.maintenance(&p, &BTreeSet::new()).is_err());
}
#[test]
fn maintenance_cannot_discard_obligations() {
    let b = bundle();
    let mut p = proposal(&b);
    p.plans.clear();
    p.documents.clear();
    assert!(b.maintenance(&p, &BTreeSet::new()).is_err());
}
#[test]
fn atomic_state_write_replaces_whole_document() {
    let repo = Repo::new();
    let p = repo.0.join("state.json");
    atomic(&p, b"{\"v\":1}").unwrap();
    atomic(&p, b"{\"v\":2}").unwrap();
    assert_eq!(fs::read_to_string(p).unwrap(), "{\"v\":2}");
}
#[test]
fn exact_revision_does_not_accept_abbreviated_hashes() {
    let repo = Repo::new();
    let rev = head(&repo.0).unwrap();
    exact_commit(&repo.0, &rev).unwrap();
    assert!(exact_commit(&repo.0, &rev[..12]).is_err());
}
#[cfg(unix)]
#[test]
fn symlink_cannot_escape_a_project_root() {
    let repo = Repo::new();
    std::os::unix::fs::symlink("/etc", repo.0.join("escape")).unwrap();
    assert!(contained(&repo.0, "escape/passwd").is_err());
}

#[test]
fn receipts_are_bound_to_exact_required_checks_and_revision() {
    let good = Receipt {
        id: "C1".into(),
        revision: "abc".into(),
        passed: true,
        exit_code: Some(0),
        timed_out: false,
        log: "check.log".into(),
    };
    checks::certify(&[good.clone()], &["C1".into()], "abc").unwrap();
    assert!(checks::certify(&[good.clone()], &["C1".into()], "def").is_err());
    assert!(checks::certify(&[good.clone()], &["C2".into()], "abc").is_err());
    assert!(checks::certify(&[good.clone(), good.clone()], &["C1".into()], "abc").is_err());
    let mut timeout = good.clone();
    timeout.timed_out = true;
    assert!(checks::certify(&[timeout], &["C1".into()], "abc").is_err());
    let mut failed = good;
    failed.exit_code = Some(1);
    assert!(checks::certify(&[failed], &["C1".into()], "abc").is_err());
}
#[test]
fn each_plan_starts_at_its_actual_dependency_baseline() {
    let repo = Repo::new();
    let mut s = State::new(repo.0.clone(), repo.0.join("plans/test"), two_plans()).unwrap();
    let initial = s.last_revision.clone();
    s.plans.get_mut("01-behavior").unwrap().accepted = Some(initial.clone());
    fs::write(repo.0.join("source.txt"), "dependency implemented\n").unwrap();
    git(&repo.0, &["add", "source.txt"]).unwrap();
    git(&repo.0, &["commit", "-qm", "dependency outcome"]).unwrap();
    s.last_revision = head(&repo.0).unwrap();
    select(&mut s).unwrap();
    assert_eq!(s.target, "02-integration");
    assert_eq!(s.plans["02-integration"].base, s.last_revision);
    assert_ne!(s.plans["02-integration"].base, initial);
}
#[test]
fn empty_progress_is_not_evidence() {
    let mut r = report("abc", Verdict::Evidence);
    r.progress = vec!["   ".into()];
    assert!(r.validate(&bundle(), &r.attempt, &r.target, "abc").is_err());
}
#[test]
fn repeated_diagnosis_does_not_unlock_an_unchanged_patch_loop() {
    let repo = Repo::new();
    let mut s = repo.state();
    s.target = "01-behavior".into();
    s.phase = Phase::Diagnose;
    let r = report(&s.last_revision, Verdict::Evidence);
    apply_report(&mut s, r.clone()).unwrap();
    s.phase = Phase::Diagnose;
    assert!(apply_report(&mut s, r).is_err());
}
#[cfg(unix)]
#[test]
fn liveness_uses_process_identity_not_only_a_pid() {
    let pid = std::process::id();
    let mut p = Pending {
        id: "attempt_1".into(),
        role: "builder".into(),
        key: "builder".into(),
        revision: "abc".into(),
        prompt: String::new(),
        pid: Some(pid),
        process_identity: process_identity(pid),
        schema: "report".into(),
    };
    assert!(pending_alive(&p));
    p.process_identity = Some("not_this_process_start".into());
    assert!(!pending_alive(&p));
}

#[test]
fn a_persisting_finding_without_a_claimed_fix_is_not_a_failed_repair() {
    let repo = Repo::new();
    let mut s = repo.state();
    s.target = "01-behavior".into();
    s.phase = Phase::Review;
    let r = report(&s.last_revision, Verdict::ChangesRequired);
    s.plans.get_mut(&s.target).unwrap().review = Some(r.clone());
    apply_report(&mut s, r).unwrap();
    assert!(!s.plans[&s.target].stalled);
}
#[test]
fn same_finding_after_an_exact_candidate_repair_triggers_diagnosis() {
    let repo = Repo::new();
    let mut s = repo.state();
    s.target = "01-behavior".into();
    s.phase = Phase::Review;
    let r = report(&s.last_revision, Verdict::ChangesRequired);
    let mut b = report(&s.last_revision, Verdict::NoChange);
    b.responses.push(Evidence {
        id: "R1".into(),
        proof: "Claimed counterevidence".into(),
    });
    let p = s.plans.get_mut(&s.target).unwrap();
    p.review = Some(r.clone());
    p.build = Some(b);
    apply_report(&mut s, r).unwrap();
    assert!(s.plans[&s.target].stalled);
}
#[test]
fn final_review_batches_all_known_affected_owners() {
    let repo = Repo::new();
    let mut s = State::new(repo.0.clone(), repo.0.join("plans/test"), two_plans()).unwrap();
    for p in s.plans.values_mut() {
        p.accepted = Some(s.last_revision.clone());
    }
    s.target = "@project".into();
    s.phase = Phase::Final;
    let mut r = report(&s.last_revision, Verdict::ChangesRequired);
    r.target = "@project".into();
    let mut second = finding();
    second.id = "R2".into();
    second.owner = "02-integration".into();
    second.requirement = "O2".into();
    r.findings.push(second);
    apply_report(&mut s, r).unwrap();
    assert!(s.plans["01-behavior"].accepted.is_none());
    assert!(s.plans["02-integration"].accepted.is_none());
    assert_eq!(s.target, "01-behavior");
    assert_eq!(s.phase, Phase::Lead);
}
