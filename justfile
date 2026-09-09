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

verify: check test

install:
    cargo install --path . --locked
