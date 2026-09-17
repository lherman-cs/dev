fn ensure_sqlite() -> Result<()> {
    let status = Command::new("sqlite3").arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status();
    match status {
        Ok(s) if s.success() => Ok(()),
        _ => bail!("`dev workflow` requires the sqlite3 CLI; install SQLite first"),
    }
}

fn sqlite(db: &Path, sql: &str, json_output: bool) -> Result<ProcessResult> {
    let mut command = Command::new("sqlite3");
    command.arg("-batch").arg("-bail").arg("-cmd").arg("PRAGMA foreign_keys=ON;").arg("-cmd").arg("PRAGMA busy_timeout=5000;");
    if json_output { command.arg("-json"); }
    command.arg(db);
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .context("launch sqlite3")?;
    child.stdin.as_mut().ok_or_else(|| anyhow!("sqlite stdin unavailable"))?.write_all(sql.as_bytes())?;
    let output = child.wait_with_output()?;
    Ok(ProcessResult {
        code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

fn repo_root() -> Result<PathBuf> {
    let out = Command::new("git").args(["rev-parse","--show-toplevel"]).output().context("resolve Git repository")?;
    ensure!(out.status.success(), "`dev workflow` must run inside a Git worktree");
    Ok(PathBuf::from(String::from_utf8(out.stdout)?.trim()))
}

fn workflow_db_path(repo: &Path) -> Result<PathBuf> {
    let out = Command::new("git").current_dir(repo).args(["rev-parse","--absolute-git-dir"]).output()?;
    ensure!(out.status.success(), "resolve worktree Git directory");
    let git_dir = PathBuf::from(String::from_utf8(out.stdout)?.trim());
    Ok(git_dir.join("dev-workflow").join("workflow.sqlite3"))
}

fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git").current_dir(repo).args(args).output()
        .with_context(|| format!("git {}", args.join(" ")))?;
    ensure!(output.status.success(), "git {} failed: {}", args.join(" "), String::from_utf8_lossy(&output.stderr).trim());
    Ok(String::from_utf8(output.stdout)?.trim_end().to_string())
}

fn resolve_commit(repo: &Path, sha: &str) -> Result<String> {
    nonempty("sha", sha)?;
    git(repo, &["rev-parse", "--verify", &format!("{sha}^{{commit}}")])
}

fn ensure_ancestor(repo: &Path, base: &str, candidate: &str) -> Result<()> {
    let status = Command::new("git").current_dir(repo).args(["merge-base","--is-ancestor",base,candidate]).status()?;
    ensure!(status.success(), "candidate {candidate} is not a descendant of {base}");
    Ok(())
}

fn ensure_clean_repo(repo: &Path) -> Result<()> {
    let status = git(repo, &["status","--porcelain=v1","--untracked-files=normal"])?;
    ensure!(status.trim().is_empty(), "candidate evidence requires a clean worktree/index; current status:\n{status}");
    Ok(())
}

fn file_digest(repo: &Path, path: &Path) -> Result<String> {
    let bytes = fs::read(path)?;
    let mut child = Command::new("git").current_dir(repo).args(["hash-object","--stdin"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn()?;
    child.stdin.as_mut().unwrap().write_all(&bytes)?;
    let out = child.wait_with_output()?;
    ensure!(out.status.success(), "git hash-object failed");
    Ok(String::from_utf8(out.stdout)?.trim().to_string())
}

fn ensure_spec_storage(repo: &Path, spec: &Path) -> Result<()> {
    if !spec.starts_with(repo) { return Ok(()); }
    let rel = spec.strip_prefix(repo).context("make spec path relative to repository")?;
    let tracked = Command::new("git").current_dir(repo).args(["ls-files", "--error-unmatch", "--"]).arg(rel)
        .stdout(Stdio::null()).stderr(Stdio::null()).status()?;
    ensure!(!tracked.success(), "workflow spec must not be a tracked source file; keep it ignored (for example under plans/) or outside the worktree");
    let ignored = Command::new("git").current_dir(repo).args(["check-ignore", "-q", "--"]).arg(rel).status()?;
    ensure!(ignored.success(), "workflow spec inside the worktree must be Git-ignored so human amendments cannot contaminate candidate evidence");
    Ok(())
}

fn approved_spec(text: &str) -> bool {
    text.lines().any(|line| {
        let normalized = line.trim().trim_start_matches('#').trim();
        normalized.eq_ignore_ascii_case("status: approved")
            || normalized.eq_ignore_ascii_case("status = approved")
            || normalized.eq_ignore_ascii_case("approved")
    })
}

fn absolutize(repo: &Path, path: &Path) -> Result<PathBuf> {
    let path = if path.is_absolute() { path.to_path_buf() } else { repo.join(path) };
    fs::canonicalize(&path).with_context(|| format!("resolve {}", path.display()))
}

fn append_spec_amendment(spec: &Path, request: i64, question: &str, answer: &str) -> Result<()> {
    let mut text = fs::read_to_string(spec)?;
    if !text.ends_with('\n') { text.push('\n'); }
    if !text.contains("\n## Approved amendments\n") {
        text.push_str("\n## Approved amendments\n\n");
    } else if !text.ends_with("\n\n") {
        text.push('\n');
    }
    text.push_str(&format!("### Human decision {request}\n\nQuestion: {question}\n\nAnswer: {answer}\n"));
    fs::write(spec, text)?;
    Ok(())
}

fn run_checks(repo: &Path, rows: &[Value]) -> Result<Vec<Value>> {
    let mut results = Vec::new();
    for row in rows {
        let raw = row.get("command").and_then(Value::as_str).ok_or_else(|| anyhow!("check row missing command"))?;
        let argv = split_command(raw)?;
        ensure!(!argv.is_empty(), "empty verification command");
        let output = Command::new(&argv[0]).args(&argv[1..]).current_dir(repo).output()
            .with_context(|| format!("run verification command {raw:?}"))?;
        results.push(json!({
            "command": raw,
            "ok": output.status.success(),
            "exit": output.status.code(),
            "stdout": truncate(&String::from_utf8_lossy(&output.stdout), OUTPUT_LIMIT),
            "stderr": truncate(&String::from_utf8_lossy(&output.stderr), OUTPUT_LIMIT),
        }));
    }
    Ok(results)
}

fn split_command(input: &str) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut chars = input.chars().peekable();
    let mut quote: Option<char> = None;
    while let Some(ch) = chars.next() {
        match quote {
            Some('\'') => {
                if ch == '\'' { quote = None; } else { buf.push(ch); }
            }
            Some('"') => {
                if ch == '"' { quote = None; }
                else if ch == '\\' { buf.push(chars.next().ok_or_else(|| anyhow!("trailing escape in check"))?); }
                else { buf.push(ch); }
            }
            Some(_) => unreachable!(),
            None => match ch {
                '\'' | '"' => quote = Some(ch),
                '\\' => buf.push(chars.next().ok_or_else(|| anyhow!("trailing escape in check"))?),
                c if c.is_whitespace() => {
                    if !buf.is_empty() { out.push(std::mem::take(&mut buf)); }
                }
                _ => buf.push(ch),
            },
        }
    }
    ensure!(quote.is_none(), "unterminated quote in verification command");
    if !buf.is_empty() { out.push(buf); }
    ensure!(!out.is_empty(), "verification command is empty");
    // The command is executed directly, never through a shell. Explicit shell
    // interpreters defeat that invariant and are therefore rejected.
    let exe = Path::new(&out[0]).file_name().and_then(|s| s.to_str()).unwrap_or(&out[0]);
    ensure!(!matches!(exe, "sh" | "bash" | "zsh" | "fish"), "verification commands may not invoke a shell; use a direct argv command");
    Ok(out)
}

fn sql_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn nonempty(name: &str, value: &str) -> Result<()> {
    ensure!(!value.trim().is_empty(), "{name} must not be empty");
    ensure!(!value.contains('\0'), "{name} contains NUL");
    Ok(())
}

fn truncate(value: &str, limit: usize) -> String {
    if value.len() <= limit { return value.to_string(); }
    let mut end = limit;
    while !value.is_char_boundary(end) { end -= 1; }
    format!("{}\n… <{} bytes omitted>", &value[..end], value.len() - end)
}

fn print_json(value: Value) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(&value)?);
    Ok(())
}

