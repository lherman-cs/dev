    fn init(spec: &Path, reset: bool) -> Result<Self> {
        ensure_sqlite()?;
        let repo = repo_root()?;
        let db = workflow_db_path(&repo)?;
        let spec = absolutize(&repo, spec)?;
        ensure!(spec.is_file(), "spec does not exist: {}", spec.display());
        let spec_text = fs::read_to_string(&spec)
            .with_context(|| format!("read spec {}", spec.display()))?;
        ensure!(approved_spec(&spec_text), "spec must be explicitly APPROVED before workflow init");
        ensure_spec_storage(&repo, &spec)?;
        if reset && db.exists() {
            fs::remove_file(&db).with_context(|| format!("remove {}", db.display()))?;
            let wal = PathBuf::from(format!("{}-wal", db.display()));
            let shm = PathBuf::from(format!("{}-shm", db.display()));
            let _ = fs::remove_file(wal);
            let _ = fs::remove_file(shm);
        }
        if let Some(parent) = db.parent() {
            fs::create_dir_all(parent)?;
        }
        let rt = Self { repo, db };
        rt.migrate()?;
        if rt.meta("spec_path")?.is_none() {
            let base = git(&rt.repo, &["rev-parse", "HEAD"])?;
            let digest = file_digest(&rt.repo, &spec)?;
            let sql = format!(
                "BEGIN IMMEDIATE;\n\
                 INSERT INTO meta(key,value) VALUES\
                 ('phase','planning'),\
                 ('spec_path',{spec}),\
                 ('spec_digest',{digest}),\
                 ('project_base',{base}),\
                 ('expected_head',{base}),\
                 ('replan_count','0'),\
                 ('final_repair_count','0'),\
                 ('verification_failures','0'),\
                 ('invalid_calls','0'),\
                 ('paused_from',''),\
                 ('pause_reason','');\n\
                 INSERT INTO events(kind,detail) VALUES('init',{detail});\n\
                 COMMIT;",
                spec = sql_quote(&spec.to_string_lossy()),
                digest = sql_quote(&digest),
                base = sql_quote(&base),
                detail = sql_quote("approved spec compiled into empty planning queue"),
            );
            rt.exec(&sql)?;
        } else {
            rt.ensure_spec_identity()?;
        }
        Ok(rt)
    }

    fn open() -> Result<Self> {
        ensure_sqlite()?;
        let repo = repo_root()?;
        let db = workflow_db_path(&repo)?;
        ensure!(db.exists(), "workflow is not initialized; run `dev workflow init --spec <approved-spec.md>`");
        let rt = Self { repo, db };
        rt.migrate()?;
        rt.ensure_spec_identity()?;
        Ok(rt)
    }

    fn dispatch(&self, action: WorkflowAction) -> Result<()> {
        match action {
            WorkflowAction::Init { .. } => unreachable!(),
            WorkflowAction::Status => self.print_status(),
            WorkflowAction::Next => self.next(),
            WorkflowAction::Plan { action } => self.plan(action),
            WorkflowAction::Task { task, review } => self.task(task, review),
            WorkflowAction::Candidate { action } => self.candidate(action),
            WorkflowAction::Review { action } => self.review(action),
            WorkflowAction::Replan { reason } => self.replan(&reason),
            WorkflowAction::Human { action } => self.human(action),
            WorkflowAction::Final { action } => self.final_action(action),
        }
    }

    fn migrate(&self) -> Result<()> {
        let version = self.scalar_i64("PRAGMA user_version;")?.unwrap_or(0);
        ensure!(version <= SCHEMA_VERSION, "workflow database schema {version} is newer than this dev binary ({SCHEMA_VERSION})");
        if version == 0 {
            self.exec(
                "BEGIN IMMEDIATE;\n\
                 PRAGMA foreign_keys=ON;\n\
                 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);\n\
                 CREATE TABLE IF NOT EXISTS tasks(\n\
                   id INTEGER PRIMARY KEY AUTOINCREMENT, ordinal INTEGER NOT NULL UNIQUE,\n\
                   title TEXT NOT NULL, goal TEXT NOT NULL,\n\
                   status TEXT NOT NULL CHECK(status IN ('pending','building','reviewing','repairing','rereviewing','accepted','blocked','obsolete')),\n\
                   base_sha TEXT, candidate_sha TEXT, repair_count INTEGER NOT NULL DEFAULT 0,\n\
                   verification_failures INTEGER NOT NULL DEFAULT 0, verification_json TEXT, last_error TEXT\n\
                 );\n\
                 CREATE TABLE IF NOT EXISTS task_requirements(\n\
                   task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,\n\
                   position INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(task_id,position));\n\
                 CREATE TABLE IF NOT EXISTS task_paths(\n\
                   task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, path TEXT NOT NULL,\n\
                   PRIMARY KEY(task_id,path));\n\
                 CREATE TABLE IF NOT EXISTS task_checks(\n\
                   id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,\n\
                   scope TEXT NOT NULL CHECK(scope IN ('task','final')), command TEXT NOT NULL);\n\
                 CREATE TABLE IF NOT EXISTS task_deps(\n\
                   task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,\n\
                   depends_on INTEGER NOT NULL REFERENCES tasks(id), PRIMARY KEY(task_id,depends_on));\n\
                 CREATE TABLE IF NOT EXISTS reviews(\n\
                   id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER REFERENCES tasks(id),\n\
                   round INTEGER NOT NULL, candidate_sha TEXT NOT NULL, verdict TEXT NOT NULL,\n\
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(task_id,round));\n\
                 CREATE TABLE IF NOT EXISTS findings(\n\
                   id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER REFERENCES tasks(id),\n\
                   round INTEGER NOT NULL, severity TEXT NOT NULL, origin TEXT NOT NULL,\n\
                   summary TEXT NOT NULL, evidence TEXT NOT NULL, blocking INTEGER NOT NULL,\
                   draft INTEGER NOT NULL DEFAULT 1);\n\
                 CREATE TABLE IF NOT EXISTS resolutions(\n\
                   finding_id INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,\n\
                   round INTEGER NOT NULL, resolution TEXT NOT NULL, evidence TEXT NOT NULL,\
                   draft INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(finding_id,round));\n\
                 CREATE TABLE IF NOT EXISTS human_requests(\n\
                   id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT,\
                   status TEXT NOT NULL CHECK(status IN ('open','answered')),\n\
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);\n\
                 CREATE TABLE IF NOT EXISTS events(\n\
                   seq INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\
                   kind TEXT NOT NULL, task_id INTEGER, detail TEXT NOT NULL);\n\
                 PRAGMA user_version=1;\n\
                 COMMIT;",
            )?;
        }
        Ok(())
    }

