    fn submit_candidate(&self, task: i64, sha: &str) -> Result<()> {
        ensure!(self.phase()? == "executing", "task candidates require phase=executing");
        let row = self.task_row(task)?;
        let status = value_str(&row, "status")?;
        ensure!(matches!(status, "building" | "repairing"), "task {task} is not owned by Builder (status={status})");
        let candidate = resolve_commit(&self.repo, sha)?;
        let head = git(&self.repo, &["rev-parse", "HEAD"])?;
        ensure!(candidate == head, "candidate must equal current HEAD; got {candidate}, HEAD is {head}");
        ensure_clean_repo(&self.repo)?;
        let predecessor = if status == "repairing" {
            value_opt_str(&row, "candidate_sha")?.ok_or_else(|| anyhow!("repair has no previous candidate"))?
        } else {
            value_opt_str(&row, "base_sha")?.ok_or_else(|| anyhow!("task has no base"))?
        };
        ensure_ancestor(&self.repo, &predecessor, &candidate)?;
        ensure!(candidate != predecessor, "candidate must advance beyond {predecessor}");
        let checks = self.query(&format!("SELECT command FROM task_checks WHERE task_id={task} AND scope='task' ORDER BY id;"))?;
        let results = run_checks(&self.repo, &checks)?;
        let all_pass = results.iter().all(|r| r["ok"].as_bool() == Some(true));
        if !all_pass {
            let failures = value_i64(&row, "verification_failures")? + 1;
            let detail = serde_json::to_string(&results)?;
            if failures >= MAX_VERIFICATION_FAILURES {
                let reason = format!("task {task} failed middleware verification {failures} times; human interruption required");
                self.exec(&format!(
                    "BEGIN IMMEDIATE; UPDATE tasks SET verification_failures={failures},last_error={err} WHERE id={task};\n\
                     UPDATE meta SET value='paused' WHERE key='phase'; UPDATE meta SET value='executing' WHERE key='paused_from';\n\
                     UPDATE meta SET value={reason} WHERE key='pause_reason';\n\
                     INSERT INTO events(kind,task_id,detail) VALUES('verification_hard_stop',{task},{detail}); COMMIT;",
                    err=sql_quote(&detail), reason=sql_quote(&reason), detail=sql_quote(&detail)))?;
                return print_json(json!({"status":"blocked","reason":reason,"verification":results}));
            }
            self.exec(&format!(
                "BEGIN IMMEDIATE; UPDATE tasks SET verification_failures={failures},last_error={err} WHERE id={task};\n\
                 INSERT INTO events(kind,task_id,detail) VALUES('verification_failed',{task},{detail}); COMMIT;",
                err=sql_quote(&detail), detail=sql_quote(&detail)))?;
            return print_json(json!({"status":"verification_failed","correction_allowed":true,"verification":results}));
        }
        let next_status = if status == "building" { "reviewing" } else { "rereviewing" };
        let repair = if status == "repairing" { value_i64(&row,"repair_count")? } else { 0 };
        self.exec(&format!(
            "BEGIN IMMEDIATE; UPDATE tasks SET status={status},candidate_sha={candidate},verification_json={verification},last_error=NULL WHERE id={task};\n\
             INSERT INTO events(kind,task_id,detail) VALUES('candidate_verified',{task},{detail}); COMMIT;",
            status=sql_quote(next_status), candidate=sql_quote(&candidate), verification=sql_quote(&serde_json::to_string(&results)?),
            detail=sql_quote(&format!("candidate {candidate}; repair_count={repair}"))))?;
        print_json(json!({"status":"verified","task":task,"candidate":candidate,"next":next_status,"verification":results}))
    }

    fn review(&self, action: ReviewAction) -> Result<()> {
        match action {
            ReviewAction::Finding { task, severity, origin, summary, evidence } => {
                self.add_finding(Some(task), severity, origin, &summary, &evidence)
            }
            ReviewAction::Resolve { task, finding, resolution, evidence } => {
                self.resolve_finding(task, finding, resolution, &evidence)
            }
            ReviewAction::Finish { task, verdict } => self.finish_review(task, verdict),
            ReviewAction::Reset { task } => self.reset_review(task),
        }
    }

    fn current_round(&self, task: i64) -> Result<i64> {
        let row = self.task_row(task)?;
        match value_str(&row, "status")? {
            "reviewing" => Ok(1),
            "rereviewing" => Ok(2),
            status => bail!("task {task} is not under review (status={status})"),
        }
    }

    fn add_finding(&self, task: Option<i64>, severity: FindingSeverity, origin: FindingOrigin, summary: &str, evidence: &str) -> Result<()> {
        nonempty("summary", summary)?;
        nonempty("evidence", evidence)?;
        let (task_sql, round) = if let Some(task) = task {
            (task.to_string(), self.current_round(task)?)
        } else {
            let phase = self.phase()?;
            ensure!(matches!(phase.as_str(), "final_review" | "final_rereview"), "final finding is not currently allowed");
            ("NULL".into(), if phase == "final_review" { 1 } else { 2 })
        };
        if round == 2 && matches!(origin, FindingOrigin::Candidate) {
            bail!("new rereview findings must declare --origin repair-regression or --origin late-discovery");
        }
        self.exec(&format!(
            "BEGIN IMMEDIATE; INSERT INTO findings(task_id,round,severity,origin,summary,evidence,blocking,draft)\n\
             VALUES({task},{round},{severity},{origin},{summary},{evidence},{blocking},1);\n\
             INSERT INTO events(kind,task_id,detail) VALUES('finding_draft',{task},{detail}); COMMIT;",
            task=task_sql, severity=sql_quote(severity.as_str()), origin=sql_quote(origin.as_str()),
            summary=sql_quote(summary), evidence=sql_quote(evidence), blocking=if severity.blocking(){1}else{0},
            detail=sql_quote(summary)))?;
        let id = self.scalar_i64("SELECT MAX(id) FROM findings;")?.unwrap_or(0);
        print_json(json!({"status":"recorded","finding":id,"blocking":severity.blocking()}))
    }

    fn resolve_finding(&self, task: i64, finding: i64, resolution: Resolution, evidence: &str) -> Result<()> {
        ensure!(self.current_round(task)? == 2, "finding resolution is required only during bounded rereview");
        nonempty("evidence", evidence)?;
        let valid = self.scalar_i64(&format!(
            "SELECT COUNT(*) FROM findings WHERE id={finding} AND task_id={task} AND round=1 AND blocking=1 AND draft=0;"))?.unwrap_or(0);
        ensure!(valid == 1, "finding {finding} is not a blocking finding from task {task}'s initial review");
        self.exec(&format!(
            "BEGIN IMMEDIATE; INSERT INTO resolutions(finding_id,round,resolution,evidence,draft)\n\
             VALUES({finding},2,{resolution},{evidence},1)\n\
             ON CONFLICT(finding_id,round) DO UPDATE SET resolution=excluded.resolution,evidence=excluded.evidence,draft=1;\n\
             COMMIT;",
            resolution=sql_quote(resolution.as_str()), evidence=sql_quote(evidence)))?;
        print_json(json!({"status":"recorded","finding":finding,"resolution":resolution.as_str()}))
    }

