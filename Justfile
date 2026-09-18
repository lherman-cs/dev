set positional-arguments

install:
    cargo install --path . --locked

test-fast:
    python3 tests/validate_assets.py
    python3 -m unittest discover -s tests -p 'test_*.py'
    node tests/check_pi_extension.mjs

test-slow:
    cargo test --locked
    cargo build --locked

test: test-fast test-slow

check: test
