    fn finish_review(&self, task: i64, verdict: ReviewVerdict) -> Result<()> {
        let round = self.current_round(task)?;
        let row = self.task_row(task)?;
        let candidate = value_opt_str(&row,"candidate_sha")?.ok_or_else(|| anyhow!("task has no candidate"))?;
        let head = git(&self.repo, &["rev-parse", "HEAD"])?;
        ensure!(head == candidate, "reviewed candidate {candidate} is no longer HEAD ({head}); refuse stale acceptance");
        if round == 2 {
            let missing = self.scalar_i64(&format!(
                "SELECT COUNT(*) FROM findings f WHERE f.task_id={task} AND f.round=1 AND f.blocking=1 AND f.draft=0\n\
                 AND NOT EXISTS(SELECT 1 FROM resolutions r WHERE r.finding_id=f.id AND r.round=2 AND r.draft=1);"))?.unwrap_or(0);
            ensure!(missing == 0, "rereview must explicitly account for every prior blocking finding");
        }
        let draft_blockers = self.scalar_i64(&format!(
            "SELECT COUNT(*) FROM findings WHERE task_id={task} AND round={round} AND blocking=1 AND draft=1;"))?.unwrap_or(0);
        let still_open = if round == 2 {
            self.scalar_i64(&format!(
                "SELECT COUNT(*) FROM resolutions r JOIN findings f ON f.id=r.finding_id\n\
                 WHERE f.task_id={task} AND r.round=2 AND r.draft=1 AND r.resolution='still_open';"))?.unwrap_or(0)
        } else { 0 };
        match verdict {
            ReviewVerdict::Pass => ensure!(draft_blockers == 0 && still_open == 0, "PASS cannot coexist with blocking findings or still-open prior findings"),
            ReviewVerdict::FixesRequired => ensure!(draft_blockers + still_open > 0, "FIXES_REQUIRED requires at least one concrete blocker"),
        }
        if round == 1 {
            let next_status = match verdict {
                ReviewVerdict::Pass => "accepted",
                ReviewVerdict::FixesRequired => "repairing",
            };
            let repair = if matches!(verdict, ReviewVerdict::FixesRequired) { 1 } else { 0 };
            self.exec(&format!(
                "BEGIN IMMEDIATE; INSERT INTO reviews(task_id,round,candidate_sha,verdict) VALUES({task},1,{candidate},{verdict});\n\
                 UPDATE findings SET draft=0 WHERE task_id={task} AND round=1 AND draft=1;\n\
                 UPDATE tasks SET status={status},repair_count={repair} WHERE id={task};\n\
                 UPDATE meta SET value={candidate} WHERE key='expected_head' AND {accepted};\n\
                 INSERT INTO events(kind,task_id,detail) VALUES('review_finished',{task},{detail}); COMMIT;",
                candidate=sql_quote(&candidate), verdict=sql_quote(verdict.as_str()), status=sql_quote(next_status), accepted=if next_status=="accepted"{"1"}else{"0"},
                detail=sql_quote(verdict.as_str())))?;
            return print_json(json!({"status":next_status,"task":task,"verdict":verdict.as_str()}));
        }
        // The single bounded repair has already happened. A residual blocker hard-stops.
        match verdict {
            ReviewVerdict::Pass => {
                self.exec(&format!(
                    "BEGIN IMMEDIATE; INSERT INTO reviews(task_id,round,candidate_sha,verdict) VALUES({task},2,{candidate},'pass');\n\
                     UPDATE findings SET draft=0 WHERE task_id={task} AND round=2 AND draft=1;\n\
                     UPDATE resolutions SET draft=0 WHERE round=2 AND draft=1 AND finding_id IN(SELECT id FROM findings WHERE task_id={task});\n\
                     UPDATE tasks SET status='accepted' WHERE id={task};\n\
                     UPDATE meta SET value={candidate} WHERE key='expected_head';\n\
                     INSERT INTO events(kind,task_id,detail) VALUES('rereview_finished',{task},'pass'); COMMIT;",
                    candidate=sql_quote(&candidate)))?;
                print_json(json!({"status":"accepted","task":task,"verdict":"pass"}))
            }
            ReviewVerdict::FixesRequired => {
                let reason = format!("task {task} still has a real blocker after the single allowed repair");
                self.exec(&format!(
                    "BEGIN IMMEDIATE; INSERT INTO reviews(task_id,round,candidate_sha,verdict) VALUES({task},2,{candidate},'fixes_required');\n\
                     UPDATE findings SET draft=0 WHERE task_id={task} AND round=2 AND draft=1;\n\
                     UPDATE resolutions SET draft=0 WHERE round=2 AND draft=1 AND finding_id IN(SELECT id FROM findings WHERE task_id={task});\n\
                     UPDATE tasks SET status='blocked',last_error={reason} WHERE id={task};\n\
                     UPDATE meta SET value='paused' WHERE key='phase'; UPDATE meta SET value='executing' WHERE key='paused_from';\n\
                     UPDATE meta SET value={reason} WHERE key='pause_reason';\n\
                     INSERT INTO events(kind,task_id,detail) VALUES('repair_limit_reached',{task},{reason}); COMMIT;",
                    candidate=sql_quote(&candidate), reason=sql_quote(&reason)))?;
                print_json(json!({"status":"blocked","task":task,"reason":reason}))
            }
        }
    }

    fn reset_review(&self, task: i64) -> Result<()> {
        let round = self.current_round(task)?;
        self.exec(&format!(
            "BEGIN IMMEDIATE; DELETE FROM resolutions WHERE round={round} AND draft=1 AND finding_id IN(SELECT id FROM findings WHERE task_id={task});\n\
             DELETE FROM findings WHERE task_id={task} AND round={round} AND draft=1;\n\
             INSERT INTO events(kind,task_id,detail) VALUES('review_draft_reset',{task},{detail}); COMMIT;",
            detail=sql_quote("lost reviewer draft cleared without changing completed evidence")))?;
        print_json(json!({"status":"reset","task":task,"round":round}))
    }

    fn replan(&self, reason: &str) -> Result<()> {
        nonempty("reason", reason)?;
        ensure!(self.phase()? == "executing", "automatic replan is allowed only during execution");
        let count = self.meta_i64("replan_count")?;
        if count >= MAX_REPLANS {
            let message = "automatic replan limit reached; human decision required";
            self.pause("executing", message)?;
            return print_json(json!({"status":"blocked","reason":message}));
        }
        ensure_clean_repo(&self.repo)?;
        let head = git(&self.repo, &["rev-parse", "HEAD"])?;
        self.exec(&format!(
            "BEGIN IMMEDIATE; UPDATE tasks SET status='obsolete' WHERE status NOT IN ('accepted','obsolete');\n\
             UPDATE meta SET value='planning' WHERE key='phase'; UPDATE meta SET value={head} WHERE key='expected_head'; UPDATE meta SET value={count} WHERE key='replan_count';\n\
             INSERT INTO events(kind,detail) VALUES('replan',{reason}); COMMIT;",
            head=sql_quote(&head), count=sql_quote(&(count + 1).to_string()), reason=sql_quote(reason)))?;
        print_json(json!({"status":"planning","replan_count":count+1,"reason":reason}))
    }

