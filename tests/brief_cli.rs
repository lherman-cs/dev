#![cfg(unix)]
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

fn git(root: &Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}
fn fixture() -> (PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!(
        "brief-cli-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap()
    ));
    let repo = root.join("repo");
    let pkg = root.join("pi");
    fs::create_dir_all(&repo).unwrap();
    let bin = pkg.join("node_modules/.bin");
    fs::create_dir_all(&bin).unwrap();
    fs::copy(
        format!("{}/pi/roles.toml", env!("CARGO_MANIFEST_DIR")),
        pkg.join("roles.toml"),
    )
    .unwrap();
    std::os::unix::fs::symlink(
        format!("{}/pi/node_modules/smol-toml", env!("CARGO_MANIFEST_DIR")),
        pkg.join("node_modules/smol-toml"),
    )
    .unwrap();
    let script = bin.join("pi");
    fs::write(&script, r#"#!/bin/sh
cat > "$BRIEF_TEST_INPUT"
if [ -n "${BRIEF_TEST_WAIT_FOR:-}" ]; then while [ ! -f "$BRIEF_TEST_WAIT_FOR" ]; do sleep 0.05; done; fi
if [ -f "$BRIEF_TEST_SAMPLE" ]; then cat "$BRIEF_TEST_SAMPLE"; exit 0; fi
cat <<'BRIEF'
# Branch consequence brief

```brief-lead
{"title":"Bottom line","body":"Behavior changes at entry","anchors":["change.txt:1"]}
```

## Entry point

```brief-section
{"id":"s-entry","title":"Entry point","anchors":["change.txt:1"],"blocks":[{"type":"text","label":"Why it matters","text":"The caller receives a new outcome.","anchors":["change.txt:1"]},{"type":"diagram","label":"Before and after","takeaway":"New flow","mermaid":"flowchart LR\nA-->B","anchors":["change.txt:1"]}]}
```
BRIEF
"#).unwrap();
    let mut perms = fs::metadata(&script).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&script, perms).unwrap();
    fs::write(root.join("xdg-open"), "#!/bin/sh\nexit 0\n").unwrap();
    let mut perms = fs::metadata(root.join("xdg-open")).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(root.join("xdg-open"), perms).unwrap();
    git(&repo, &["init", "-q"]);
    git(&repo, &["config", "user.name", "Fixture"]);
    git(&repo, &["config", "user.email", "fixture@example.test"]);
    fs::write(repo.join("change.txt"), "before\n").unwrap();
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-qm", "base"]);
    git(&repo, &["branch", "-M", "main"]);
    git(&repo, &["switch", "-qc", "feature"]);
    fs::write(repo.join("change.txt"), "after\n").unwrap();
    (root, repo, pkg)
}
fn start(repo: &Path, home: &Path, pkg: &Path, args: &[&str]) -> (Child, String, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_dev"))
        .current_dir(repo)
        .arg("brief")
        .args(args)
        .env("DEV_PI_PACKAGE", pkg)
        .env("XDG_DATA_HOME", home.join("data"))
        .env("BRIEF_TEST_INPUT", home.join("model-input.txt"))
        .env("BRIEF_TEST_SAMPLE", home.join("sample.md"))
        .env(
            "PATH",
            format!("{}:{}", home.display(), std::env::var("PATH").unwrap()),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let mut first = String::new();
    reader.read_line(&mut first).unwrap();
    if !first.contains("http://127.0.0.1:") {
        let mut stderr = String::new();
        child
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut stderr)
            .unwrap();
        panic!("brief did not serve: {first} {stderr}");
    }
    let url = first
        .split_whitespace()
        .find(|part| part.starts_with("http://"))
        .unwrap()
        .to_string();
    let mut second = String::new();
    reader.read_line(&mut second).unwrap();
    (
        child,
        url,
        second.trim_start_matches("Saved in ").trim().to_string(),
    )
}
fn request(
    url: &str,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> (u16, String) {
    let host = url.trim_start_matches("http://").trim_end_matches('/');
    let mut stream = TcpStream::connect(host).unwrap();
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    )
    .unwrap();
    for (key, value) in headers {
        write!(stream, "{key}: {value}\r\n").unwrap();
    }
    write!(stream, "\r\n{body}").unwrap();
    stream.flush().unwrap();
    let mut out = String::new();
    stream.read_to_string(&mut out).unwrap();
    let status = out.split_whitespace().nth(1).unwrap().parse().unwrap();
    let (response_headers, data) = out.split_once("\r\n\r\n").unwrap();
    if response_headers
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        let mut input = data.as_bytes();
        let mut decoded = Vec::new();
        loop {
            let end = input.windows(2).position(|w| w == b"\r\n").unwrap();
            let size =
                usize::from_str_radix(std::str::from_utf8(&input[..end]).unwrap(), 16).unwrap();
            if size == 0 {
                break;
            }
            input = &input[end + 2..];
            decoded.extend_from_slice(&input[..size]);
            input = &input[size + 2..];
        }
        (status, String::from_utf8(decoded).unwrap())
    } else {
        (status, data.to_string())
    }
}
#[test]
fn generation_reports_progress_before_pi_finishes() {
    let (root, repo, pkg) = fixture();
    let release = root.join("release-pi");
    let mut child = Command::new(env!("CARGO_BIN_EXE_dev"))
        .current_dir(&repo)
        .args(["brief", "--base", "main"])
        .env("DEV_PI_PACKAGE", &pkg)
        .env("XDG_DATA_HOME", root.join("data"))
        .env("BRIEF_TEST_INPUT", root.join("model-input.txt"))
        .env("BRIEF_TEST_WAIT_FOR", &release)
        .env(
            "PATH",
            format!("{}:{}", root.display(), std::env::var("PATH").unwrap()),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let stderr = child.stderr.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            if sender.send(line.unwrap()).is_err() {
                break;
            }
        }
    });
    let mut messages = Vec::new();
    loop {
        let line = receiver
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or_else(|_| {
                child.kill().unwrap();
                panic!("No generation progress while Pi is pending: {messages:?}");
            });
        messages.push(line.clone());
        if line.contains("Generating brief with Pi") {
            break;
        }
    }
    assert!(
        messages
            .iter()
            .any(|line| line.contains("Capturing brief comparison"))
    );
    assert!(
        child.try_wait().unwrap().is_none(),
        "Pi should still be pending"
    );
    fs::write(&release, "go").unwrap();
    let mut first = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut first)
        .unwrap();
    assert!(first.contains("http://127.0.0.1:"), "{first}");
    child.kill().unwrap();
    child.wait().unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reference_markdown_drives_full_viewer_and_reopens_unchanged() {
    let (root, repo, pkg) = fixture();
    let source = include_str!("fixtures/brief-reference.md");
    fs::write(root.join("sample.md"), source).unwrap();
    fs::create_dir_all(repo.join("src")).unwrap();
    fs::create_dir_all(repo.join("docs")).unwrap();
    fs::write(
        repo.join("src/scream.rs"),
        "// base core\n// base feedback\n",
    )
    .unwrap();
    fs::write(repo.join("src/rtp.rs"), "// base timing\n").unwrap();
    fs::write(repo.join("docs/architecture.md"), "Base system map\n").unwrap();
    git(&repo, &["add", "src", "docs"]);
    git(&repo, &["commit", "-qm", "add sample source paths"]);
    fs::write(
        repo.join("src/scream.rs"),
        "// illustrative controller policy\n// illustrative gap handling\n",
    )
    .unwrap();
    fs::write(
        repo.join("src/rtp.rs"),
        "// illustrative clock confidence\n",
    )
    .unwrap();
    fs::write(
        repo.join("docs/architecture.md"),
        "Illustrative sender to receiver path\n",
    )
    .unwrap();
    let (mut child, url, dir) = start(&repo, &root, &pkg, &["--base", "main"]);
    let (status, body) = request(&url, "GET", "/data", &[], "");
    assert_eq!(status, 200);
    let data: Value = serde_json::from_str(&body).unwrap();
    let id = data["revision"]["id"].as_str().unwrap().to_owned();
    let token = data["token"].as_str().unwrap();
    assert_eq!(data["revision"]["markdown"], source.trim());
    assert!(data["revision"]["change_stats"]["files"].as_u64().unwrap() > 0);
    assert!(data["revision"]["change_stats"]["added"].is_u64());
    assert!(data["revision"]["change_stats"]["removed"].is_u64());
    assert_eq!(
        data["revision"]["document"]["sections"]
            .as_array()
            .unwrap()
            .len(),
        22
    );
    assert_eq!(
        data["revision"]["document"]["sections"][0]["kind"],
        "overview"
    );
    assert_eq!(
        data["revision"]["document"]["sections"][1]["blocks"][1]["type"],
        "columns"
    );
    assert_eq!(
        data["revision"]["targets"][1]["anchors"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let (_, app) = request(&url, "GET", "/app.js", &[], "");
    assert!(app.contains("case 'columns'"));
    assert!(app.contains("case 'timeline'"));
    assert!(app.contains("case 'icon_list'"));
    let feedback = json!({"notes":{"s-system-map":"Keep architecture distinction"}}).to_string();
    assert_eq!(
        request(
            &url,
            "POST",
            "/feedback",
            &[
                ("X-Brief-Token", token),
                ("Content-Type", "application/json")
            ],
            &feedback
        )
        .0,
        200
    );
    child.kill().unwrap();
    child.wait().unwrap();
    let (mut reopened, reopened_url, _) = start(&repo, &root, &pkg, &["--open", &id]);
    let (_, reopened_body) = request(&reopened_url, "GET", "/data", &[], "");
    let saved: Value = serde_json::from_str(&reopened_body).unwrap();
    assert_eq!(saved["revision"]["markdown"], source.trim());
    assert_eq!(
        saved["feedback"]["notes"]["s-system-map"],
        "Keep architecture distinction"
    );
    let reopened_token = saved["token"].as_str().unwrap();
    let (_, exported) = request(
        &reopened_url,
        "POST",
        "/export",
        &[("X-Brief-Token", reopened_token)],
        "",
    );
    let exported = fs::read_to_string(exported.trim().strip_prefix("Exported ").unwrap()).unwrap();
    assert!(exported.contains("docs/architecture.md:1"));
    assert!(exported.contains("src/scream.rs:1"));
    assert!(exported.contains("Keep architecture distinction"));
    reopened.kill().unwrap();
    reopened.wait().unwrap();
    assert!(Path::new(&dir).join(format!("{id}.json")).exists());
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn invalid_directives_leave_existing_revision_untouched() {
    let (root, repo, pkg) = fixture();
    let (mut child, url, dir) = start(&repo, &root, &pkg, &["--base", "main"]);
    let (_, body) = request(&url, "GET", "/data", &[], "");
    let saved: Value = serde_json::from_str(&body).unwrap();
    let id = saved["revision"]["id"].as_str().unwrap();
    let original = fs::read(Path::new(&dir).join(format!("{id}.json"))).unwrap();
    child.kill().unwrap();
    child.wait().unwrap();
    let script = pkg.join("node_modules/.bin/pi");
    fs::write(&script, "#!/bin/sh\nprintf '# Branch consequence brief\\n\\n```brief-lead\\n{\\\"title\\\":\\\"Bottom line\\\",\\\"body\\\":\\\"Unsafe\\\",\\\"anchors\\\":[]}\\n```\\n\\n## Bad\\n\\n```brief-section\\n{\\\"id\\\":\\\"s-bad\\\",\\\"title\\\":\\\"Bad\\\",\\\"anchors\\\":[],\\\"blocks\\\":[{\\\"type\\\":\\\"html\\\",\\\"label\\\":\\\"Unsafe\\\",\\\"anchors\\\":[]}]}\\n```\\n'\n").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_dev"))
        .current_dir(&repo)
        .args(["brief", "--base", "main"])
        .env("DEV_PI_PACKAGE", &pkg)
        .env("XDG_DATA_HOME", root.join("data"))
        .env("BRIEF_TEST_INPUT", root.join("model-input.txt"))
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("invalid typed Markdown"),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let revisions: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(|entry| {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            (name.ends_with(".json") && !name.ends_with("-feedback.json")).then_some(name)
        })
        .collect();
    assert_eq!(revisions, vec![format!("{id}.json")]);
    assert_eq!(
        fs::read(Path::new(&dir).join(format!("{id}.json"))).unwrap(),
        original
    );
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn cli_generation_feedback_reopen_and_export_do_not_regenerate() {
    let (root, repo, pkg) = fixture();
    let (mut child, url, dir) = start(&repo, &root, &pkg, &["--base", "main"]);
    let (status, body) = request(&url, "GET", "/data", &[], "");
    assert_eq!(status, 200);
    let data: Value = serde_json::from_str(&body).unwrap();
    let id = data["revision"]["id"].as_str().unwrap();
    let token = data["token"].as_str().unwrap();
    assert_eq!(
        data["revision"]["document"]["sections"][0]["title"],
        "Entry point"
    );
    for (path, marker) in [
        ("/", "Branch consequence brief"),
        ("/style.css", ".comment-button"),
        ("/app.js", "aria-controls"),
    ] {
        let (status, body) = request(&url, "GET", path, &[], "");
        assert_eq!(status, 200, "{path} must be locally served");
        assert!(body.contains(marker), "{path} must contain {marker}");
    }
    let (_, page) = request(&url, "GET", "/", &[], "");
    assert!(page.contains("href=\"/style.css\""));
    assert!(page.contains("src=\"/app.js\""));
    assert!(page.contains("src=\"/mermaid.js\""));
    assert!(
        !page.contains("https://"),
        "viewer assets must remain local"
    );
    assert!(
        fs::read_to_string(root.join("model-input.txt"))
            .unwrap()
            .contains("+after")
    );
    assert!(Path::new(&dir).join(format!("{id}-snapshot.txt")).exists());
    assert_eq!(
        request(
            &url,
            "POST",
            "/feedback",
            &[("Content-Type", "application/json")],
            "{}"
        )
        .0,
        403
    );
    let notes =
        json!({"notes":{"s-entry":"Preserve this precise comment","general":"Cross-cutting concern"}})
            .to_string();
    assert_eq!(
        request(
            &url,
            "POST",
            "/feedback",
            &[
                ("Content-Type", "application/json"),
                ("X-Brief-Token", token)
            ],
            &notes
        )
        .0,
        200
    );
    child.kill().unwrap();
    child.wait().unwrap();
    fs::remove_file(root.join("model-input.txt")).unwrap();
    let (mut reopened, new_url, new_dir) = start(&repo, &root, &pkg, &["--open", "latest"]);
    assert_eq!(new_dir, dir);
    let (status, body) = request(&new_url, "GET", "/data", &[], "");
    assert_eq!(status, 200);
    let data: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        data["feedback"]["notes"]["s-entry"],
        "Preserve this precise comment"
    );
    assert!(
        !root.join("model-input.txt").exists(),
        "reopen must not invoke Pi"
    );
    let token = data["token"].as_str().unwrap();
    assert_eq!(
        request(&new_url, "POST", "/export", &[("X-Brief-Token", token)], "").0,
        200
    );
    let exported = fs::read_to_string(Path::new(&dir).join(format!("{id}-feedback.md"))).unwrap();
    assert!(exported.contains("Preserve this precise comment"));
    assert!(exported.contains("Cross-cutting concern"));
    assert!(exported.contains("change.txt:1"));
    assert!(!exported.contains("The caller receives a new outcome."));
    fs::write(repo.join("change.txt"), "modified after capture\n").unwrap();
    let (_, status) = request(&new_url, "GET", "/status", &[], "");
    assert!(status.contains("Working tree changed since"));
    reopened.kill().unwrap();
    reopened.wait().unwrap();

    fs::write(repo.join("spec.md"), "Intent: keep compatibility\n").unwrap();
    let (mut newer, newer_url, _) = start(
        &repo,
        &root,
        &pkg,
        &["--base", "main", "--spec", "spec.md", "Focus on migration"],
    );
    let (_, body) = request(&newer_url, "GET", "/data", &[], "");
    let later: Value = serde_json::from_str(&body).unwrap();
    assert_ne!(later["revision"]["id"], id);
    assert_eq!(later["revision"]["spec"], "spec.md");
    assert!(later["feedback"]["notes"].as_object().unwrap().is_empty());
    assert!(
        fs::read_to_string(root.join("model-input.txt"))
            .unwrap()
            .contains("SPEC (intent only): spec.md")
    );
    newer.kill().unwrap();
    newer.wait().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_dev"))
        .current_dir(&repo)
        .args(["brief", "--list"])
        .env("XDG_DATA_HOME", root.join("data"))
        .output()
        .unwrap();
    assert!(output.status.success());
    let list = String::from_utf8(output.stdout).unwrap();
    assert!(list.contains(id));
    assert!(list.contains(later["revision"]["id"].as_str().unwrap()));
    assert_eq!(
        fs::read_to_string(Path::new(&dir).join(format!("{id}-feedback.md"))).unwrap(),
        exported
    );
    fs::remove_dir_all(root).unwrap();
}
