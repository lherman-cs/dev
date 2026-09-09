//! The runner's wire contracts. Agent reports are proposals, never authoritative state.
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Obligation {
    pub id: String,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Check {
    pub id: String,
    pub argv: Vec<String>,
    pub cwd: String,
    pub timeout_seconds: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub id: String,
    pub file: String,
    pub depends_on: Vec<String>,
    pub obligations: Vec<String>,
    pub checks: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub version: u32,
    pub name: String,
    pub spec: String,
    pub obligations: Vec<Obligation>,
    pub plans: Vec<Plan>,
    pub checks: Vec<Check>,
    pub readiness_checks: Vec<String>,
    pub final_checks: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Bundle {
    pub manifest: Manifest,
    /// Includes spec.md and every declared plan file. This is the sealed text, not an agent cache.
    pub documents: BTreeMap<String, String>,
}

pub fn text(value: &str, label: &str) -> Result<()> {
    ensure!(!value.trim().is_empty(), "{label} must not be empty");
    ensure!(!value.contains('\0'), "{label} contains NUL");
    Ok(())
}
pub fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
pub fn relative(value: &str) -> Result<()> {
    text(value, "relative path")?;
    ensure!(
        !Path::new(value).is_absolute(),
        "absolute path is not allowed: {value}"
    );
    ensure!(
        Path::new(value)
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir)),
        "path escapes its root: {value}"
    );
    Ok(())
}
fn unique<'a>(
    values: impl IntoIterator<Item = &'a String>,
    label: &str,
) -> Result<BTreeSet<String>> {
    let mut result = BTreeSet::new();
    for v in values {
        ensure!(identifier(v), "invalid {label}: {v}");
        ensure!(result.insert(v.clone()), "duplicate {label}: {v}");
    }
    Ok(result)
}
fn references(values: &[String], known: &BTreeSet<String>, label: &str) -> Result<()> {
    let ids = unique(values, label)?;
    ensure!(
        ids.is_subset(known),
        "unknown {label}: {:?}",
        ids.difference(known).collect::<Vec<_>>()
    );
    Ok(())
}
impl Bundle {
    pub fn validate(&self) -> Result<()> {
        let m = &self.manifest;
        ensure!(m.version == 1, "unsupported project version {}", m.version);
        text(&m.name, "project name")?;
        ensure!(m.spec == "spec.md", "binding contract must be spec.md");
        text(
            self.documents.get(&m.spec).context("missing spec.md")?,
            "spec.md",
        )?;
        ensure!(
            !m.plans.is_empty() && !m.obligations.is_empty(),
            "project needs plans and binding obligations"
        );
        let obligations = unique(m.obligations.iter().map(|o| &o.id), "obligation ID")?;
        for o in &m.obligations {
            text(&o.text, "obligation")?;
        }
        let plan_ids = unique(m.plans.iter().map(|p| &p.id), "plan ID")?;
        let check_ids = unique(m.checks.iter().map(|c| &c.id), "check ID")?;
        for c in &m.checks {
            ensure!(!c.argv.is_empty(), "check {} has no executable", c.id);
            text(&c.argv[0], "check executable")?;
            ensure!(
                c.argv.iter().all(|a| !a.contains('\0')),
                "NUL in command arguments"
            );
            relative(&c.cwd)?;
            ensure!(
                (1..=86400).contains(&c.timeout_seconds),
                "check timeout must be 1..86400 seconds"
            );
        }
        ensure!(
            !m.readiness_checks.is_empty() && !m.final_checks.is_empty(),
            "readiness and final checks are required"
        );
        references(&m.readiness_checks, &check_ids, "readiness check")?;
        references(&m.final_checks, &check_ids, "final check")?;
        let mut owners = BTreeMap::new();
        let mut files = BTreeSet::from([m.spec.clone()]);
        for p in &m.plans {
            let number = p.id.split('-').next().unwrap_or("");
            ensure!(
                number.len() >= 2
                    && number.bytes().all(|b| b.is_ascii_digit())
                    && p.id.contains('-'),
                "plan ID must start with a padded number: {}",
                p.id
            );
            ensure!(
                p.file == format!("{}.md", p.id),
                "plan file must be <id>.md"
            );
            files.insert(p.file.clone());
            text(
                self.documents
                    .get(&p.file)
                    .with_context(|| format!("missing {}", p.file))?,
                "plan document",
            )?;
            ensure!(
                !p.obligations.is_empty() && !p.checks.is_empty(),
                "plan {} needs obligations and executable checks",
                p.id
            );
            references(&p.obligations, &obligations, "plan obligation")?;
            references(&p.checks, &check_ids, "plan check")?;
            references(&p.depends_on, &plan_ids, "dependency")?;
            ensure!(!p.depends_on.contains(&p.id), "self dependency in {}", p.id);
            for o in &p.obligations {
                ensure!(
                    owners.insert(o.clone(), p.id.clone()).is_none(),
                    "obligation {o} has multiple owners; split it into independently verifiable obligations"
                );
            }
        }
        ensure!(
            owners.len() == obligations.len(),
            "every binding obligation must have one plan owner"
        );
        ensure!(
            files == self.documents.keys().cloned().collect::<BTreeSet<_>>(),
            "bundle contains undeclared documents"
        );
        let mut done = BTreeSet::new();
        loop {
            let before = done.len();
            for p in &m.plans {
                if p.depends_on.iter().all(|d| done.contains(d)) {
                    done.insert(p.id.clone());
                }
            }
            if done.len() == m.plans.len() {
                break;
            }
            ensure!(done.len() > before, "cyclic plan dependency graph");
        }
        Ok(())
    }
    pub fn plan(&self, id: &str) -> Result<&Plan> {
        self.manifest
            .plans
            .iter()
            .find(|p| p.id == id)
            .with_context(|| format!("unknown plan {id}"))
    }
    pub fn obligations(&self, target: &str) -> Result<BTreeSet<String>> {
        if target == "@project" {
            Ok(self
                .manifest
                .obligations
                .iter()
                .map(|o| o.id.clone())
                .collect())
        } else {
            Ok(self.plan(target)?.obligations.iter().cloned().collect())
        }
    }
    pub fn binding_bytes(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(&(
            &self.documents[&self.manifest.spec],
            &self.manifest.obligations,
            &self.manifest.checks,
            &self.manifest.readiness_checks,
            &self.manifest.final_checks,
        ))?)
    }
    pub fn maintenance(&self, proposal: &Proposal, accepted: &BTreeSet<String>) -> Result<Bundle> {
        text(&proposal.rationale, "maintenance rationale")?;
        let mut candidate = self.clone();
        candidate.manifest.plans = proposal.plans.clone();
        candidate.documents = BTreeMap::new();
        for d in &proposal.documents {
            ensure!(
                d.file != self.manifest.spec,
                "maintenance cannot supply binding spec text"
            );
            ensure!(
                candidate
                    .documents
                    .insert(d.file.clone(), d.text.clone())
                    .is_none(),
                "duplicate proposed document"
            );
        }
        candidate.documents.insert(
            self.manifest.spec.clone(),
            self.documents[&self.manifest.spec].clone(),
        );
        candidate.validate()?;
        ensure!(
            self.binding_bytes()? == candidate.binding_bytes()?,
            "maintenance changed the binding contract/checks"
        );
        for id in accepted {
            let old = self.plan(id)?;
            ensure!(
                candidate.plan(id)? == old
                    && candidate.documents[&old.file] == self.documents[&old.file],
                "maintenance changed accepted plan {id}"
            );
        }
        Ok(candidate)
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Verdict {
    Completed,
    NoChange,
    Accepted,
    ChangesRequired,
    Blocked,
    RequiresReplanning,
    Evidence,
    Prepared,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub id: String,
    pub proof: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Finding {
    pub id: String,
    pub owner: String,
    pub kind: String,
    pub requirement: String,
    pub evidence: String,
    pub impact: String,
    pub closure: String,
    pub alternative: String,
    pub new_evidence: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Resolution {
    pub id: String,
    pub disposition: String,
    pub evidence: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Boundary {
    pub requirement: String,
    pub evidence: String,
    pub why_no_local_solution: String,
    pub attempted_remedies: Vec<String>,
    pub decision_needed: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    pub rationale: String,
    pub plans: Vec<Plan>,
    pub documents: Vec<Document>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Document {
    pub file: String,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Report {
    pub attempt: String,
    pub target: String,
    pub revision: String,
    pub verdict: Verdict,
    pub summary: String,
    pub coverage: Vec<Evidence>,
    pub findings: Vec<Finding>,
    pub resolutions: Vec<Resolution>,
    pub responses: Vec<Evidence>,
    pub progress: Vec<String>,
    pub next_action: String,
    pub boundary: Option<Boundary>,
    pub proposal: Option<Proposal>,
}
impl Report {
    pub fn validate(
        &self,
        bundle: &Bundle,
        attempt: &str,
        target: &str,
        revision: &str,
    ) -> Result<()> {
        ensure!(
            self.attempt == attempt && self.target == target,
            "report attempt/target mismatch"
        );
        ensure!(
            self.revision == revision,
            "report revision differs from actual candidate {revision}"
        );
        text(&self.summary, "summary")?;
        for evidence in &self.progress {
            text(evidence, "progress evidence")?;
        }
        let known = bundle.obligations(target)?;
        let coverage = unique(self.coverage.iter().map(|e| &e.id), "coverage ID")?;
        ensure!(
            coverage.is_subset(&known),
            "coverage references unknown obligations"
        );
        for e in self.coverage.iter().chain(&self.responses) {
            text(&e.proof, "evidence")?;
        }
        unique(self.responses.iter().map(|e| &e.id), "response ID")?;
        unique(self.resolutions.iter().map(|e| &e.id), "resolution ID")?;
        let open = unique(self.findings.iter().map(|f| &f.id), "finding ID")?;
        for f in &self.findings {
            let owner = bundle.plan(&f.owner)?;
            ensure!(
                owner.obligations.contains(&f.requirement)
                    || f.requirement.starts_with("INVARIANT:")
                    || f.requirement.starts_with("DESIGN:"),
                "finding requirement must be its owning obligation ID or a named INVARIANT:/DESIGN: contract principle"
            );
            ensure!(
                target == "@project" || target == f.owner,
                "finding owner differs from active plan"
            );
            ensure!(
                matches!(f.kind.as_str(), "correctness" | "design" | "verification"),
                "unknown finding kind"
            );
            for (k, v) in [
                ("requirement", &f.requirement),
                ("evidence", &f.evidence),
                ("impact", &f.impact),
                ("closure", &f.closure),
            ] {
                text(v, k)?;
            }
            if f.kind == "design" {
                text(&f.alternative, "demonstrably better design alternative")?;
            }
        }
        for r in &self.resolutions {
            ensure!(
                matches!(r.disposition.as_str(), "RESOLVED" | "REFUTED"),
                "unknown resolution"
            );
            ensure!(
                !open.contains(&r.id),
                "finding {} is both open and closed",
                r.id
            );
            text(&r.evidence, "resolution evidence")?;
        }
        if self.verdict == Verdict::Accepted {
            ensure!(open.is_empty(), "ACCEPTED cannot contain OPEN findings");
            ensure!(
                coverage == known,
                "ACCEPTED must cover every applicable obligation"
            );
            ensure!(
                self.boundary.is_none(),
                "ACCEPTED cannot contain a boundary conflict"
            );
        }
        if self.verdict == Verdict::ChangesRequired {
            ensure!(
                !open.is_empty(),
                "CHANGES_REQUIRED needs actionable findings"
            );
        }
        if matches!(self.verdict, Verdict::Blocked | Verdict::RequiresReplanning) {
            let b = self
                .boundary
                .as_ref()
                .context("boundary verdict needs concrete boundary evidence")?;
            for v in [
                &b.requirement,
                &b.evidence,
                &b.why_no_local_solution,
                &b.decision_needed,
            ] {
                text(v, "boundary field")?;
            }
            ensure!(
                !b.attempted_remedies.is_empty(),
                "boundary verdict needs feasible remedies already attempted"
            );
            for v in &b.attempted_remedies {
                text(v, "attempted remedy")?;
            }
        }
        if self.verdict == Verdict::Prepared {
            ensure!(
                self.proposal.is_some(),
                "PREPARED needs a maintenance proposal"
            );
        }
        Ok(())
    }
    pub fn followup(&self, previous: &Report) -> Result<()> {
        for old in &previous.findings {
            if let Some(f) = self.findings.iter().find(|f| f.id == old.id) {
                if f.owner != old.owner {
                    text(
                        &f.new_evidence,
                        "finding reassignment requires approved maintenance evidence",
                    )?;
                }
                if f.closure != old.closure || f.requirement != old.requirement {
                    text(&f.new_evidence, "changed closure requires new evidence")?;
                }
            } else {
                ensure!(
                    self.resolutions.iter().any(|r| r.id == old.id),
                    "finding {} silently disappeared",
                    old.id
                );
            }
        }
        for f in &self.findings {
            if !previous.findings.iter().any(|old| old.id == f.id) {
                text(
                    &f.new_evidence,
                    "new follow-up finding requires material new evidence",
                )?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Action {
    Build,
    Diagnose,
    Review,
    Investigate,
    Adjudicate,
    Maintain,
    StopBlocked,
    StopReplan,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Decision {
    pub attempt: String,
    pub target: String,
    pub action: Action,
    pub instruction: String,
    pub evidence: String,
    pub settled_decision: String,
    pub replace_worker: bool,
}
impl Decision {
    pub fn validate(
        &self,
        attempt: &str,
        target: &str,
        stalled: bool,
        boundary: Option<Verdict>,
    ) -> Result<()> {
        ensure!(
            self.attempt == attempt && self.target == target,
            "decision attempt/target mismatch"
        );
        text(&self.instruction, "next action")?;
        text(&self.evidence, "decision evidence")?;
        if stalled && self.action == Action::Build {
            bail!(
                "same failure survived a repair: diagnose, investigate, or adjudicate before another patch"
            );
        }
        match self.action {
            Action::StopBlocked => ensure!(
                boundary == Some(Verdict::Blocked),
                "BLOCKED needs independent boundary validation"
            ),
            Action::StopReplan => ensure!(
                boundary == Some(Verdict::RequiresReplanning),
                "replanning needs independent boundary validation"
            ),
            _ => {}
        }
        Ok(())
    }
}
