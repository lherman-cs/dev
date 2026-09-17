    fn human(&self, action: HumanAction) -> Result<()> {
        match action {
            HumanAction::Ask { question } => {
                nonempty("question", &question)?;
                let from = self.phase()?;
                ensure!(from != "complete", "completed workflow cannot ask a new human question");
                self.exec(&format!(
                    "BEGIN IMMEDIATE; INSERT INTO human_requests(question,status) VALUES({question},'open');\n\
                     UPDATE meta SET value={from} WHERE key='paused_from'; UPDATE meta SET value='paused' WHERE key='phase';\n\
                     UPDATE meta SET value={question} WHERE key='pause_reason';\n\
                     INSERT INTO events(kind,detail) VALUES('human_question',{question}); COMMIT;",
                    question=sql_quote(&question), from=sql_quote(&from)))?;
                let id = self.scalar_i64("SELECT MAX(id) FROM human_requests;")?.unwrap_or(0);
                print_json(json!({"status":"paused","request":id,"question":question}))
            }
            HumanAction::Answer { request, answer } => {
                nonempty("answer", &answer)?;
                let row = self.query_one(&format!("SELECT id,question,status FROM human_requests WHERE id={request};"))?
                    .ok_or_else(|| anyhow!("human request {request} does not exist"))?;
                ensure!(value_str(&row,"status")? == "open", "human request {request} is already answered");
                let spec = PathBuf::from(self.meta("spec_path")?.ok_or_else(|| anyhow!("spec path missing"))?);
                ensure_clean_repo(&self.repo)?;
                let head = git(&self.repo, &["rev-parse", "HEAD"])?;
                append_spec_amendment(&spec, request, value_str(&row,"question")?, &answer)?;
                let digest = file_digest(&self.repo, &spec)?;
                self.exec(&format!(
                    "BEGIN IMMEDIATE; UPDATE human_requests SET answer={answer},status='answered' WHERE id={request};\n\
                     UPDATE tasks SET status='obsolete' WHERE status NOT IN ('accepted','obsolete');\n\
                     UPDATE meta SET value={digest} WHERE key='spec_digest'; UPDATE meta SET value={head} WHERE key='expected_head'; UPDATE meta SET value='planning' WHERE key='phase';\n\
                     UPDATE meta SET value='' WHERE key='pause_reason'; UPDATE meta SET value='' WHERE key='paused_from';\n\
                     INSERT INTO events(kind,detail) VALUES('human_answer',{detail}); COMMIT;",
                    answer=sql_quote(&answer), digest=sql_quote(&digest), head=sql_quote(&head),
                    detail=sql_quote(&format!("request {request} answered; Planner required"))))?;
                print_json(json!({"status":"planning","request":request,"spec":spec}))
            }
            HumanAction::Pause { reason } => {
                nonempty("reason", &reason)?;
                let from = self.phase()?;
                self.pause(&from, &reason)?;
                print_json(json!({"status":"paused","reason":reason}))
            }
            HumanAction::AdoptHead { reason } => {
                nonempty("reason", &reason)?;
                ensure!(self.phase()? == "paused", "adopt-head is allowed only from a paused workflow");
                ensure!(self.open_human_request()?.is_none(), "answer the open semantic request instead of adopting HEAD around it");
                ensure_clean_repo(&self.repo)?;
                let head = git(&self.repo, &["rev-parse", "HEAD"])?;
                let from = self.meta("paused_from")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "executing".into());
                self.exec(&format!(
                    "BEGIN IMMEDIATE; UPDATE meta SET value={head} WHERE key='expected_head'; UPDATE meta SET value={from} WHERE key='phase';\n\
                     UPDATE meta SET value='' WHERE key='pause_reason'; UPDATE meta SET value='' WHERE key='paused_from';\n\
                     INSERT INTO events(kind,detail) VALUES('human_adopt_head',{detail}); COMMIT;",
                    head=sql_quote(&head), from=sql_quote(&from), detail=sql_quote(&format!("{head}: {reason}"))))?;
                print_json(json!({"status":from,"expected_head":head,"reason":reason}))
            }
            HumanAction::Resume => {
                ensure!(self.phase()? == "paused", "workflow is not paused");
                ensure!(self.open_human_request()?.is_none(), "an unanswered human request must be answered, not resumed around");
                let from = self.meta("paused_from")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "executing".into());
                self.exec(&format!(
                    "BEGIN IMMEDIATE; UPDATE meta SET value={from} WHERE key='phase'; UPDATE meta SET value='' WHERE key='pause_reason';\n\
                     UPDATE meta SET value='' WHERE key='paused_from'; INSERT INTO events(kind,detail) VALUES('resumed','operational pause resumed'); COMMIT;",
                    from=sql_quote(&from)))?;
                print_json(json!({"status":from}))
            }
        }
    }

    fn prepare_final_review(&self) -> Result<()> {
        let head = git(&self.repo, &["rev-parse", "HEAD"])?;
        ensure_clean_repo(&self.repo)?;
        let checks = self.query("SELECT command FROM task_checks WHERE task_id IS NULL AND scope='final' ORDER BY id;")?;
        let results = run_checks(&self.repo, &checks)?;
        if !results.iter().all(|v| v["ok"].as_bool() == Some(true)) {
            let reason = "final integrated validation failed before final review";
            self.pause("executing", reason)?;
            return print_json(json!({"action":"human","reason":reason,"verification":results}));
        }
        let verification = serde_json::to_string(&results)?;
        self.exec(&format!(
            "BEGIN IMMEDIATE; INSERT INTO meta(key,value) VALUES('final_candidate',{head}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;\n\
             INSERT INTO meta(key,value) VALUES('final_verification_json',{verification}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;\n\
             DELETE FROM meta WHERE key='final_previous_candidate'; UPDATE meta SET value='final_review' WHERE key='phase';\n\
             INSERT INTO events(kind,detail) VALUES('final_review_ready',{detail}); COMMIT;",
            head=sql_quote(&head), verification=sql_quote(&verification), detail=sql_quote(&format!("candidate {head}"))))?;
        print_json(json!({"action":"final_review","role":"reviewer_strong","candidate":head,"context_command":"dev workflow final context","verification":results}))
    }

    fn final_action(&self, action: FinalAction) -> Result<()> {
        match action {
            FinalAction::Context => self.final_context(),
            FinalAction::Finding { severity, origin, summary, evidence } => {
                self.add_finding(None, severity, origin, &summary, &evidence)
            }
            FinalAction::Resolve { finding, resolution, evidence } => self.resolve_final_finding(finding, resolution, &evidence),
            FinalAction::Finish { verdict } => self.finish_final_review(verdict),
            FinalAction::Candidate { sha } => self.submit_final_candidate(&sha),
        }
    }

