set positional-arguments

# Binary only. Does not install dotfiles or invoke install.sh.
install:
    cargo install --path . --locked

# Optional: update ONLY workflow assets in an existing target worktree.
install-workflow target:
    python3 scripts/install_workflow.py "$1"

# Python developer dependencies: python3 -m pip install -r tests/requirements.txt
check:
    python3 tests/validate_assets.py
    python3 -m unittest discover -s tests -p 'test_*.py'
    cargo test --locked
    cargo build --locked
    python3 tests/launcher_e2e.py --binary target/debug/dev
