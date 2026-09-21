set positional-arguments

install:
    cargo install --path . --locked

test-fast:
    python3 tests/validate_assets.py
    npm run check --prefix pi

test-slow:
    cargo test --locked
    cargo build --locked

test: test-fast test-slow

check: test
