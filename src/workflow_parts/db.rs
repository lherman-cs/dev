    fn submit_final_candidate(&self, sha: &str) -> Result<()> {
        ensure!(self.phase()? == "final_repair", "final candidate allowed only during final_repair");
        let count = self.meta_i64("final_repair_count")?;
        ensure!(count < 1, "final repair limit reached");
        let previous = self.meta("final_candidate")?.ok_or_else(|| anyhow!("original final candidate missing"))?;
        let candidate = resolve_commit(&self.repo, sha)?;
        let head = git(&self.repo, &["rev-parse", "HEAD"])?;
        ensure!(candidate == head, "final repair candidate must equal HEAD");
        ensure_clean_repo(&self.repo)?;
        ensure_ancestor(&self.repo, &previous, &candidate)?;
        ensure!(previous != candidate, "final repair must advance HEAD");
        let checks = self.query("SELECT command FROM task_checks WHERE task_id IS NULL AND scope='final' ORDER BY id;")?;
        let results = run_checks(&self.repo, &checks)?;
        if !results.iter().all(|v| v["ok"].as_bool() == Some(true)) {
            let reason = "final repair candidate failed integrated validation";
            self.pause("final_repair", reason)?;
            return print_json(json!({"status":"blocked","reason":reason,"verification":results}));
        }
        let verification = serde_json::to_string(&results)?;
        self.exec(&format!(
            "BEGIN IMMEDIATE; INSERT INTO meta(key,value) VALUES('final_previous_candidate',{previous}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;\n\
             UPDATE meta SET value={candidate} WHERE key='final_candidate';\n\
             INSERT INTO meta(key,value) VALUES('final_verification_json',{verification}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;\n\
             UPDATE meta SET value='1' WHERE key='final_repair_count'; UPDATE meta SET value='final_rereview' WHERE key='phase';\n\
             INSERT INTO events(kind,detail) VALUES('final_candidate',{detail}); COMMIT;",
            previous=sql_quote(&previous), candidate=sql_quote(&candidate), verification=sql_quote(&verification), detail=sql_quote(&candidate)))?;
        print_json(json!({"status":"final_rereview","candidate":candidate,"verification":results}))
    }

    fn record_invalid_call(&self, detail: &str) -> Result<()> {
        let current = self.meta_i64("invalid_calls")?;
        let next = current + 1;
        let phase = self.phase()?;
        if next >= 2 && phase != "complete" && phase != "paused" {
            let reason = format!("two consecutive invalid workflow calls; stop instead of tool-call thrashing. Last error: {detail}");
            self.exec(&format!(
                "BEGIN IMMEDIATE; UPDATE meta SET value={count} WHERE key='invalid_calls'; UPDATE meta SET value={phase} WHERE key='paused_from';\n\
                 UPDATE meta SET value='paused' WHERE key='phase'; UPDATE meta SET value={reason} WHERE key='pause_reason';\n\
                 INSERT INTO events(kind,detail) VALUES('invalid_call_hard_stop',{reason}); COMMIT;",
                count=sql_quote(&next.to_string()), phase=sql_quote(&phase), reason=sql_quote(&reason)))?;
        } else {
            self.exec(&format!(
                "BEGIN IMMEDIATE; UPDATE meta SET value={count} WHERE key='invalid_calls'; INSERT INTO events(kind,detail) VALUES('invalid_call',{detail}); COMMIT;",
                count=sql_quote(&next.to_string()), detail=sql_quote(detail)))?;
        }
        Ok(())
    }

    fn reset_invalid_calls(&self) -> Result<()> {
        if self.meta_i64("invalid_calls")? == 0 { return Ok(()); }
        self.exec("UPDATE meta SET value='0' WHERE key='invalid_calls';")
    }

    fn print_status(&self) -> Result<()> {
        let phase = self.phase()?;
        let tasks = self.query("SELECT status,COUNT(*) AS count FROM tasks GROUP BY status ORDER BY status;")?;
        let current = self.query_one(
            "SELECT id,ordinal,title,status,candidate_sha,repair_count,verification_failures,verification_json,last_error\n\
             FROM tasks WHERE status IN ('building','reviewing','repairing','rereviewing','blocked') ORDER BY ordinal LIMIT 1;")?;
        print_json(json!({
            "schema": SCHEMA_VERSION,
            "phase": phase,
            "spec": self.meta("spec_path")?,
            "spec_digest": self.meta("spec_digest")?,
            "project_base": self.meta("project_base")?,
            "expected_head": self.meta("expected_head")?,
            "replan_count": self.meta_i64("replan_count")?,
            "final_repair_count": self.meta_i64("final_repair_count")?,
            "invalid_calls": self.meta_i64("invalid_calls")?,
            "tasks": tasks,
            "current": current,
            "pause_reason": self.meta("pause_reason")?,
        }))
    }

    fn review_verification(&self, task: i64) -> Result<Vec<Value>> {
        let row = self.task_row(task)?;
        let raw = value_opt_str(&row,"verification_json")?;
        Ok(match raw {
            Some(raw) => serde_json::from_str(&raw).unwrap_or_default(),
            None => Vec::new(),
        })
    }

    fn task_row(&self, task: i64) -> Result<Value> {
        self.query_one(&format!(
            "SELECT id,ordinal,title,goal,status,base_sha,candidate_sha,repair_count,verification_failures,verification_json,last_error FROM tasks WHERE id={task};"))?
            .ok_or_else(|| anyhow!("task {task} does not exist"))
    }

    fn phase(&self) -> Result<String> {
        self.meta("phase")?.ok_or_else(|| anyhow!("workflow phase missing"))
    }

    fn meta(&self, key: &str) -> Result<Option<String>> {
        let rows = self.query(&format!("SELECT value FROM meta WHERE key={};", sql_quote(key)))?;
        Ok(rows.first().and_then(|v| v.get("value")).and_then(Value::as_str).map(ToOwned::to_owned))
    }

    fn meta_i64(&self, key: &str) -> Result<i64> {
        Ok(self.meta(key)?.unwrap_or_else(|| "0".into()).parse().with_context(|| format!("meta {key} is not integer"))?)
    }

    fn open_human_request(&self) -> Result<Option<i64>> {
        self.scalar_i64("SELECT id FROM human_requests WHERE status='open' ORDER BY id LIMIT 1;")
    }

    fn pause(&self, from: &str, reason: &str) -> Result<()> {
        self.exec(&format!(
            "BEGIN IMMEDIATE; UPDATE meta SET value='paused' WHERE key='phase'; UPDATE meta SET value={from} WHERE key='paused_from';\n\
             UPDATE meta SET value={reason} WHERE key='pause_reason'; INSERT INTO events(kind,detail) VALUES('paused',{reason}); COMMIT;",
            from=sql_quote(from), reason=sql_quote(reason)))
    }

    fn exec(&self, sql: &str) -> Result<()> {
        let result = sqlite(&self.db, sql, false)?;
        ensure!(result.code == 0, "sqlite failed: {}", result.stderr.trim());
        Ok(())
    }

    fn exec_json(&self, sql: &str) -> Result<Value> {
        let result = sqlite(&self.db, sql, true)?;
        ensure!(result.code == 0, "sqlite failed: {}", result.stderr.trim());
        let text = result.stdout.trim();
        if text.is_empty() { return Ok(json!([])); }
        serde_json::from_str(text).context("parse sqlite JSON output")
    }

    fn query(&self, sql: &str) -> Result<Vec<Value>> {
        let value = self.exec_json(sql)?;
        match value {
            Value::Array(values) => Ok(values),
            other => bail!("sqlite query returned non-array JSON: {other}"),
        }
    }

    fn query_one(&self, sql: &str) -> Result<Option<Value>> {
        Ok(self.query(sql)?.into_iter().next())
    }

    fn scalar_i64(&self, sql: &str) -> Result<Option<i64>> {
        let Some(row) = self.query_one(sql)? else { return Ok(None); };
        first_scalar_i64(&row).ok_or_else(|| anyhow!("query did not return integer scalar")).map(Some)
    }

