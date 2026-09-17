    fn ensure_spec_identity(&self) -> Result<()> {
        let Some(spec_path) = self.meta("spec_path")? else { return Ok(()); };
        let path = PathBuf::from(spec_path);
        ensure!(path.is_file(), "approved spec disappeared: {}", path.display());
        let text = fs::read_to_string(&path)?;
        ensure!(approved_spec(&text), "spec is no longer APPROVED; human alignment is required");
        let current = file_digest(&self.repo, &path)?;
        let stored = self.meta("spec_digest")?.unwrap_or_default();
        if current != stored {
            let phase = self.phase()?;
            if phase == "complete" {
                bail!("approved spec changed after workflow completion; initialize a new workflow deliberately");
            }
            ensure_clean_repo(&self.repo)?;
            let head = git(&self.repo, &["rev-parse", "HEAD"])?;
            let sql = format!(
                "BEGIN IMMEDIATE;\n\
                 UPDATE tasks SET status='obsolete' WHERE status NOT IN ('accepted','obsolete');\n\
                 UPDATE meta SET value={digest} WHERE key='spec_digest';\n\
                 UPDATE meta SET value={head} WHERE key='expected_head'; UPDATE meta SET value='planning' WHERE key='phase';\n\
                 INSERT INTO events(kind,detail) VALUES('spec_changed',{detail});\n\
                 COMMIT;",
                digest = sql_quote(&current), head = sql_quote(&head),
                detail = sql_quote("approved spec digest changed; non-accepted work invalidated and Planner required"),
            );
            self.exec(&sql)?;
        }
        Ok(())
    }

    fn plan(&self, action: PlanAction) -> Result<()> {
        ensure!(self.phase()? == "planning", "plan mutations are allowed only while phase=planning");
        match action {
            PlanAction::Add { title, goal, requirements, paths, checks, depends_on } => {
                nonempty("title", &title)?;
                nonempty("goal", &goal)?;
                for value in requirements.iter().chain(paths.iter()).chain(checks.iter()) {
                    nonempty("plan field", value)?;
                }
                for check in &checks {
                    let _ = split_command(check)?;
                }
                for dep in &depends_on {
                    let exists = self.scalar_i64(&format!("SELECT COUNT(*) FROM tasks WHERE id={dep} AND status!='obsolete';"))?.unwrap_or(0);
                    ensure!(exists == 1, "dependency task {dep} does not exist or is obsolete");
                }
                let ordinal = self.scalar_i64("SELECT COALESCE(MAX(ordinal),0)+1 FROM tasks;")?.unwrap_or(1);
                let task_ref = format!("(SELECT id FROM tasks WHERE ordinal={ordinal})");
                let mut sql = format!(
                    "BEGIN IMMEDIATE;\nINSERT INTO tasks(ordinal,title,goal,status) VALUES({ordinal},{title},{goal},'pending');\n",
                    title = sql_quote(&title), goal = sql_quote(&goal));
                for (i, req) in requirements.iter().enumerate() {
                    sql.push_str(&format!("INSERT INTO task_requirements(task_id,position,text) VALUES({task_ref},{},{req});\n", i + 1, req=sql_quote(req)));
                }
                for path in paths {
                    sql.push_str(&format!("INSERT INTO task_paths(task_id,path) VALUES({task_ref},{path});\n", path=sql_quote(&path)));
                }
                for check in checks {
                    sql.push_str(&format!("INSERT INTO task_checks(task_id,scope,command) VALUES({task_ref},'task',{cmd});\n", cmd=sql_quote(&check)));
                }
                for dep in depends_on {
                    sql.push_str(&format!("INSERT INTO task_deps(task_id,depends_on) VALUES({task_ref},{dep});\n"));
                }
                sql.push_str(&format!("INSERT INTO events(kind,task_id,detail) VALUES('task_added',{task_ref},{detail});\n", detail=sql_quote(&title)));
                sql.push_str(&format!("SELECT id FROM tasks WHERE ordinal={ordinal};\nCOMMIT;"));
                let out = self.exec_json(&sql)?;
                let task_id = first_scalar_i64(&out).ok_or_else(|| anyhow!("sqlite did not return task id"))?;
                print_json(json!({"status":"ok","task":task_id,"ordinal":ordinal}))
            }
            PlanAction::FinalCheck { check } => {
                let _ = split_command(&check)?;
                self.exec(&format!(
                    "BEGIN IMMEDIATE; INSERT INTO task_checks(task_id,scope,command) VALUES(NULL,'final',{cmd});\n\
                     INSERT INTO events(kind,detail) VALUES('final_check_added',{cmd}); COMMIT;",
                    cmd=sql_quote(&check)))?;
                print_json(json!({"status":"ok"}))
            }
            PlanAction::Ready => {
                let pending = self.scalar_i64("SELECT COUNT(*) FROM tasks WHERE status='pending';")?.unwrap_or(0);
                ensure!(pending > 0, "Planner must create at least one pending task");
                let bad_dep = self.scalar_i64(
                    "SELECT COUNT(*) FROM task_deps d JOIN tasks t ON t.id=d.task_id JOIN tasks p ON p.id=d.depends_on\n\
                     WHERE t.status='pending' AND p.status='obsolete';")?.unwrap_or(0);
                ensure!(bad_dep == 0, "plan contains dependency on obsolete task");
                self.exec(
                    "BEGIN IMMEDIATE; UPDATE meta SET value='executing' WHERE key='phase';\n\
                     INSERT INTO events(kind,detail) VALUES('plan_ready','Planner declared executable queue'); COMMIT;")?;
                print_json(json!({"status":"ready","remaining":pending}))
            }
        }
    }

    fn next(&self) -> Result<()> {
        self.ensure_spec_identity()?;
        let phase = self.phase()?;
        match phase.as_str() {
            "planning" => {
                let spec = self.meta("spec_path")?.unwrap_or_default();
                print_json(json!({"action":"plan","role":"planner","spec":spec}))
            }
            "executing" => self.next_execution(),
            "final_review" => print_json(json!({"action":"final_review","role":"reviewer_strong"})),
            "final_repair" => print_json(json!({"action":"final_repair","role":"builder_strong","context_command":"dev workflow final context"})),
            "final_rereview" => print_json(json!({"action":"final_rereview","role":"reviewer_strong","context_command":"dev workflow final context"})),
            "paused" | "blocked" => {
                let reason = self.meta("pause_reason")?.unwrap_or_else(|| "workflow requires human intervention".into());
                let request = self.open_human_request()?;
                print_json(json!({"action":"human","reason":reason,"request":request}))
            }
            "complete" => print_json(json!({"action":"complete","candidate":self.meta("final_candidate")?})),
            other => bail!("unknown workflow phase {other}"),
        }
    }

