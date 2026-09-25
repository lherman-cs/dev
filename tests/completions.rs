#![cfg(unix)]
use std::{fs, path::Path, process::Command};

#[test]
fn installer_wires_generated_completions_idempotently() {
    let binary = env!("CARGO_BIN_EXE_dev");
    let root = std::env::temp_dir().join(format!(
        "dev-completions-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap()
    ));
    fs::create_dir_all(&root).unwrap();
    let installer = format!(
        "{}/scripts/install-dev-completions.sh",
        env!("CARGO_MANIFEST_DIR")
    );
    let binary_dir = Path::new(binary).parent().unwrap();
    for (shell, rc) in [("bash", ".bashrc"), ("zsh", ".zshrc")] {
        let home = root.join(shell);
        fs::create_dir_all(&home).unwrap();
        for _ in 0..2 {
            let output = Command::new("bash")
                .arg(&installer)
                .env("HOME", &home)
                .env("SHELL", format!("/bin/{shell}"))
                .env_remove("XDG_DATA_HOME")
                .env(
                    "PATH",
                    format!(
                        "{}:{}",
                        binary_dir.display(),
                        std::env::var("PATH").unwrap()
                    ),
                )
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let completion = home.join(format!(".local/share/dev/completions/dev.{shell}"));
        let source = fs::read_to_string(completion).unwrap();
        assert!(source.contains("dev"));
        assert!(source.contains("brief"));
        let hook = fs::read_to_string(home.join(rc)).unwrap();
        assert_eq!(hook.lines().count(), 1, "hook must not duplicate");
        assert!(hook.contains(&format!("dev.{shell}")));
        if shell == "bash" {
            let output = Command::new("bash")
                .arg("-c")
                .arg("source \"$1\"; complete -p dev")
                .arg("bash")
                .arg(home.join(rc))
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("_dev"));
        }
    }
    fs::remove_dir_all(root).unwrap();
}
