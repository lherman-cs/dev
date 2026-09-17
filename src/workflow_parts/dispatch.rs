    fn next_execution(&self) -> Result<()> {
        if let Some(row) = self.query_one(
            "SELECT id,status,title,goal,base_sha,candidate_sha,repair_count,verification_json,last_error FROM tasks\n\
             WHERE status IN ('building','reviewing','repairing','rereviewing','blocked') ORDER BY ordinal LIMIT 1;")? {
            return self.action_for_task_row(&row);
        }
        let expected = self.meta("expected_head")?.ok_or_else(|| anyhow!("expected execution HEAD missing"))?;
        let current_head = git(&self.repo, &["rev-parse", "HEAD"])?;
        if current_head != expected {
            let reason = format!("HEAD moved outside workflow from {expected} to {current_head}; human may inspect and `dev workflow human adopt-head --reason ...`");
            self.pause("executing", &reason)?;
            return print_json(json!({"action":"human","reason":reason,"expected_head":expected,"head":current_head}));
        }

        let ready_sql =
            "SELECT t.id,t.status,t.title,t.goal,t.base_sha,t.candidate_sha,t.repair_count,t.last_error\n\
             FROM tasks t WHERE t.status='pending' AND NOT EXISTS (\n\
               SELECT 1 FROM task_deps d JOIN tasks p ON p.id=d.depends_on\n\
               WHERE d.task_id=t.id AND p.status!='accepted')\n\
             ORDER BY t.ordinal LIMIT 1;";
        if let Some(row) = self.query_one(ready_sql)? {
            let task = value_i64(&row, "id")?;
            let base = git(&self.repo, &["rev-parse", "HEAD"])?;
            self.exec(&format!(
                "BEGIN IMMEDIATE; UPDATE tasks SET status='building',base_sha={base},last_error=NULL WHERE id={task} AND status='pending';\n\
                 INSERT INTO events(kind,task_id,detail) VALUES('build_dispatched',{task},{detail}); COMMIT;",
                base=sql_quote(&base), detail=sql_quote("task became current build unit")))?;
            let row = self.query_one(&format!(
                "SELECT id,status,title,goal,base_sha,candidate_sha,repair_count,verification_json,last_error FROM tasks WHERE id={task};"))?
                .ok_or_else(|| anyhow!("task disappeared"))?;
            return self.action_for_task_row(&row);
        }
        let remaining = self.scalar_i64("SELECT COUNT(*) FROM tasks WHERE status NOT IN ('accepted','obsolete');")?.unwrap_or(0);
        if remaining > 0 {
            let reason = "no runnable task exists; dependency queue is inconsistent or blocked";
            self.pause("blocked", reason)?;
            return print_json(json!({"action":"human","reason":reason}));
        }
        self.prepare_final_review()
    }

    fn action_for_task_row(&self, row: &Value) -> Result<()> {
        let task = value_i64(row, "id")?;
        let status = value_str(row, "status")?;
        let common = json!({
            "task": task,
            "title": value_str(row,"title")?,
            "context_command": format!("dev workflow task --task {task}"),
            "review_context_command": format!("dev workflow task --task {task} --review"),
            "repair_count": value_i64(row,"repair_count")?,
            "last_error": row.get("last_error").cloned().unwrap_or(Value::Null),
        });
        let mut obj = common.as_object().cloned().unwrap_or_default();
        match status {
            "building" => { obj.insert("action".into(), json!("build")); obj.insert("role".into(), json!("builder")); }
            "reviewing" => { obj.insert("action".into(), json!("review")); obj.insert("role".into(), json!("reviewer")); }
            "repairing" => { obj.insert("action".into(), json!("repair")); obj.insert("role".into(), json!("builder")); }
            "rereviewing" => { obj.insert("action".into(), json!("rereview")); obj.insert("role".into(), json!("reviewer")); }
            "blocked" => {
                obj.insert("action".into(), json!("human"));
                obj.insert("reason".into(), json!(row.get("last_error").and_then(Value::as_str).unwrap_or("task blocked")));
            }
            _ => bail!("unsupported current task status {status}"),
        }
        print_json(Value::Object(obj))
    }

    fn task(&self, task: i64, review: bool) -> Result<()> {
        let row = self.task_row(task)?;
        let reqs = self.query(&format!("SELECT position,text FROM task_requirements WHERE task_id={} ORDER BY position;", task))?;
        let paths = self.query(&format!("SELECT path FROM task_paths WHERE task_id={} ORDER BY path;", task))?;
        let checks = self.query(&format!("SELECT id,command FROM task_checks WHERE task_id={} AND scope='task' ORDER BY id;", task))?;
        let deps = self.query(&format!("SELECT depends_on FROM task_deps WHERE task_id={} ORDER BY depends_on;", task))?;
        let findings = self.query(&format!(
            "SELECT id,round,severity,origin,summary,evidence,blocking,draft FROM findings WHERE task_id={} ORDER BY id;", task))?;
        let mut out = json!({
            "task": row,
            "requirements": reqs,
            "paths": paths,
            "checks": checks,
            "dependencies": deps,
            "findings": findings,
        });
        if review {
            let status = out["task"]["status"].as_str().unwrap_or("");
            ensure!(matches!(status, "reviewing" | "rereviewing"), "review context available only while task is under review");
            let base = out["task"]["base_sha"].as_str().ok_or_else(|| anyhow!("task has no base SHA"))?;
            let candidate = out["task"]["candidate_sha"].as_str().ok_or_else(|| anyhow!("task has no candidate SHA"))?;
            let diff_base = if status == "rereviewing" {
                let prior = self.query_one(&format!("SELECT candidate_sha FROM reviews WHERE task_id={} AND round=1;", task))?
                    .and_then(|v| v.get("candidate_sha").and_then(Value::as_str).map(ToOwned::to_owned))
                    .ok_or_else(|| anyhow!("rereview has no initial reviewed candidate"))?;
                out["previous_candidate"] = json!(prior);
                out["required_resolutions"] = json!(self.query(&format!(
                    "SELECT f.id,f.severity,f.summary,f.evidence FROM findings f\n\
                     WHERE f.task_id={} AND f.round=1 AND f.blocking=1 AND f.draft=0 ORDER BY f.id;", task))?);
                out["previous_candidate"].as_str().unwrap().to_string()
            } else { base.to_string() };
            let diff = git(&self.repo, &["diff", "--no-ext-diff", "--unified=8", &format!("{diff_base}..{candidate}")])?;
            ensure!(diff.len() <= MAX_REVIEW_DIFF_BYTES,
                "task diff is {} bytes (> {}); split/replan instead of poisoning Reviewer context", diff.len(), MAX_REVIEW_DIFF_BYTES);
            out["diff_base"] = json!(diff_base);
            out["diff"] = json!(diff);
            out["verification"] = json!(self.review_verification(task)?);
        }
        print_json(out)
    }

    fn candidate(&self, action: CandidateAction) -> Result<()> {
        match action {
            CandidateAction::Submit { task, sha } => self.submit_candidate(task, &sha),
        }
    }

