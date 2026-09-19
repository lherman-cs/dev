set positional-arguments

install:
    cargo install --path . --locked

test-fast:
    python3 tests/validate_assets.py

test-slow:
    cargo test --locked
    cargo build --locked

test: test-fast test-slow

check: test
