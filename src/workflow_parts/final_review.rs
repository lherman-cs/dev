    fn final_context(&self) -> Result<()> {
        let phase = self.phase()?;
        ensure!(matches!(phase.as_str(), "final_review" | "final_repair" | "final_rereview"), "final context is not available in phase={phase}");
        let project_base = self.meta("project_base")?.ok_or_else(|| anyhow!("project base missing"))?;
        let candidate = if phase == "final_repair" {
            git(&self.repo, &["rev-parse", "HEAD"])?
        } else {
            self.meta("final_candidate")?.ok_or_else(|| anyhow!("final candidate missing"))?
        };
        let diff_base = if phase == "final_rereview" {
            self.meta("final_previous_candidate")?.ok_or_else(|| anyhow!("final rereview is missing its previous candidate"))?
        } else { project_base.clone() };
        let diff = git(&self.repo, &["diff", "--no-ext-diff", "--unified=8", &format!("{diff_base}..{candidate}")])?;
        ensure!(diff.len() <= MAX_FINAL_DIFF_BYTES,
            "final diff is {} bytes (> {}); workflow requires a human-guided integration review boundary", diff.len(), MAX_FINAL_DIFF_BYTES);
        let tasks = self.query("SELECT id,ordinal,title,goal,candidate_sha,repair_count FROM tasks WHERE status='accepted' ORDER BY ordinal;")?;
        let checks = self.query("SELECT command FROM task_checks WHERE task_id IS NULL AND scope='final' ORDER BY id;")?;
        let findings = self.query("SELECT id,round,severity,summary,evidence,blocking,draft FROM findings WHERE task_id IS NULL ORDER BY id;")?;
        print_json(json!({
            "spec": self.meta("spec_path")?, "spec_digest": self.meta("spec_digest")?,
            "project_base": project_base, "diff_base": diff_base, "candidate": candidate, "tasks": tasks, "final_checks": checks,
            "verification": self.meta("final_verification_json")?.and_then(|v| serde_json::from_str::<Value>(&v).ok()).unwrap_or(Value::Null),
            "findings": findings, "diff": diff,
        }))
    }

    fn resolve_final_finding(&self, finding: i64, resolution: Resolution, evidence: &str) -> Result<()> {
        ensure!(self.phase()? == "final_rereview", "final blocker resolution is allowed only during final_rereview");
        nonempty("evidence", evidence)?;
        let valid = self.scalar_i64(&format!(
            "SELECT COUNT(*) FROM findings WHERE id={finding} AND task_id IS NULL AND round=1 AND blocking=1 AND draft=0;"))?.unwrap_or(0);
        ensure!(valid == 1, "finding {finding} is not an initial final-review blocker");
        self.exec(&format!(
            "BEGIN IMMEDIATE; INSERT INTO resolutions(finding_id,round,resolution,evidence,draft) VALUES({finding},2,{resolution},{evidence},1)\n\
             ON CONFLICT(finding_id,round) DO UPDATE SET resolution=excluded.resolution,evidence=excluded.evidence,draft=1; COMMIT;",
            resolution=sql_quote(resolution.as_str()), evidence=sql_quote(evidence)))?;
        print_json(json!({"status":"recorded","finding":finding,"resolution":resolution.as_str()}))
    }

    fn finish_final_review(&self, verdict: ReviewVerdict) -> Result<()> {
        let phase = self.phase()?;
        ensure!(matches!(phase.as_str(), "final_review" | "final_rereview"), "final review finish not allowed in phase={phase}");
        let round = if phase == "final_review" { 1 } else { 2 };
        let candidate = self.meta("final_candidate")?.ok_or_else(|| anyhow!("final candidate missing"))?;
        let head = git(&self.repo, &["rev-parse", "HEAD"])?;
        ensure!(head == candidate, "final reviewed candidate {candidate} is no longer HEAD ({head}); refuse stale acceptance");
        if round == 2 {
            let missing = self.scalar_i64(
                "SELECT COUNT(*) FROM findings f WHERE f.task_id IS NULL AND f.round=1 AND f.blocking=1 AND f.draft=0\n\
                 AND NOT EXISTS(SELECT 1 FROM resolutions r WHERE r.finding_id=f.id AND r.round=2 AND r.draft=1);")?.unwrap_or(0);
            ensure!(missing == 0, "final rereview must explicitly account for every initial final blocker");
        }
        let blockers = self.scalar_i64(&format!(
            "SELECT COUNT(*) FROM findings WHERE task_id IS NULL AND round={round} AND blocking=1 AND draft=1;"))?.unwrap_or(0);
        let still_open = if round == 2 {
            self.scalar_i64(
                "SELECT COUNT(*) FROM resolutions r JOIN findings f ON f.id=r.finding_id WHERE f.task_id IS NULL AND r.round=2 AND r.draft=1 AND r.resolution='still_open';")?.unwrap_or(0)
        } else { 0 };
        match verdict {
            ReviewVerdict::Pass => ensure!(blockers == 0 && still_open == 0, "final PASS cannot coexist with blocking findings or still-open initial blockers"),
            ReviewVerdict::FixesRequired => ensure!(blockers + still_open > 0, "final FIXES_REQUIRED requires a concrete blocker"),
        }
        if phase == "final_review" {
            match verdict {
                ReviewVerdict::Pass => {
                    let candidate = self.meta("final_candidate")?.unwrap_or_default();
                    self.exec(&format!(
                        "BEGIN IMMEDIATE; UPDATE findings SET draft=0 WHERE task_id IS NULL AND round=1 AND draft=1;\n\
                         UPDATE meta SET value='complete' WHERE key='phase';\n\
                         INSERT INTO meta(key,value) VALUES('final_reviewed_head',{candidate}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;\n\
                         INSERT INTO events(kind,detail) VALUES('complete',{detail}); COMMIT;",
                        candidate=sql_quote(&candidate), detail=sql_quote("final review passed")))?;
                    print_json(json!({"status":"complete","candidate":candidate}))
                }
                ReviewVerdict::FixesRequired => {
                    self.exec(
                        "BEGIN IMMEDIATE; UPDATE findings SET draft=0 WHERE task_id IS NULL AND round=1 AND draft=1;\n\
                         UPDATE meta SET value='final_repair' WHERE key='phase';\n\
                         INSERT INTO events(kind,detail) VALUES('final_repair','single integrated final repair wave'); COMMIT;")?;
                    print_json(json!({"status":"final_repair","repair_limit":1}))
                }
            }
        } else {
            match verdict {
                ReviewVerdict::Pass => {
                    let candidate = self.meta("final_candidate")?.unwrap_or_default();
                    self.exec(&format!(
                        "BEGIN IMMEDIATE; UPDATE findings SET draft=0 WHERE task_id IS NULL AND round=2 AND draft=1;\n\
                         UPDATE resolutions SET draft=0 WHERE round=2 AND draft=1 AND finding_id IN(SELECT id FROM findings WHERE task_id IS NULL);\n\
                         UPDATE meta SET value='complete' WHERE key='phase';\n\
                         INSERT INTO meta(key,value) VALUES('final_reviewed_head',{candidate}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;\n\
                         INSERT INTO events(kind,detail) VALUES('complete','final rereview passed'); COMMIT;",
                        candidate=sql_quote(&candidate)))?;
                    print_json(json!({"status":"complete","candidate":candidate}))
                }
                ReviewVerdict::FixesRequired => {
                    let reason = "residual blocker after the single final repair wave";
                    self.pause("final_rereview", reason)?;
                    print_json(json!({"status":"blocked","reason":reason}))
                }
            }
        }
    }

