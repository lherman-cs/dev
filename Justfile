set positional-arguments

# Binary only. Does not install dotfiles or invoke install.sh.
install:
    cargo install --path . --locked

# Optional: update ONLY workflow assets in an existing target worktree.
install-workflow target:
    python3 scripts/install_workflow.py "$1"

# Local deterministic checks. No CI, network calls, or live model invocations.
# Python prerequisites: python3 -m pip install -r tests/requirements.txt
# Cargo may fetch locked dependencies on a cold cache; tests themselves are local.
test-fast:
    python3 tests/validate_assets.py
    python3 -m unittest discover -s tests -p 'test_*.py'

# Compile and exercise the actual launcher with a fake Codex executable.
test-slow:
    cargo test --locked
    cargo build --locked
    python3 tests/launcher_e2e.py --binary target/debug/dev
    python3 tests/workflow_e2e.py --binary target/debug/dev

test: test-fast test-slow

# Keep the existing developer entry point.
check: test
