default:
    @just --list

fmt:
    cargo fmt

check:
    cargo fmt -- --check
    cargo check --locked

test:
    cargo test --locked

build:
    cargo build --locked

workflow-test:
    python3 -m unittest discover -s tests -p 'test_*.py'

verify: workflow-test check test

install:
    cargo install --path . --locked
