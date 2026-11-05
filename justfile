# Project commands. `just` lists them.

set shell := ["bash", "-euo", "pipefail", "-c"]
# DATABASE_URL for the API, its tests and sqlx's compile-time query checks.
set dotenv-load := true

default:
    @just --list

# Install web dependencies (Rust fetches its own on first build).
setup:
    cd web && npm ci

# Create the local database, apply migrations and load the development sample data.
db:
    cd api && sqlx database create && sqlx migrate run --source crates/api/migrations
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f api/seed/dev.sql

# Run local S3, the API and the web app together; Ctrl+C stops all three.
dev:
    trap 'kill 0' EXIT; scripts/dev-s3.sh & (cd api && cargo run) & (cd web && npm run dev) & wait

# Run only the local S3 server (Garage) that replay uploads go to.
s3:
    scripts/dev-s3.sh

# Regenerate the OpenAPI spec and the web client's types after changing API routes or types.
openapi:
    cd api && cargo run --quiet -- openapi > openapi.json
    cd web && npm run --silent api:generate
    cd api && cargo sqlx prepare --workspace

# Build the map packer staff run in their browser into web/public/viewer-pack.wasm, after changing
# api/crates/viewer-pack. The file is committed, so the web app builds without Rust.
wasm:
    # Dependencies build from ~/.cargo; the remap keeps the builder's home folder out of this public file.
    cd api && RUSTFLAGS="-C strip=symbols --remap-path-prefix=$HOME=~" cargo build --release --target wasm32-unknown-unknown -p sourcejump-viewer-pack-web
    cp api/target/wasm32-unknown-unknown/release/sourcejump_viewer_pack_web.wasm web/public/viewer-pack.wasm

# Format all code.
fmt:
    cd api && cargo fmt
    cd web && npx prettier --write .

# Everything that must pass before a commit: docs budget, formatting, lints, types, tests, generated files, style guide screenshots.
check:
    scripts/doc-budget.sh
    cd api && cargo fmt --check
    cd api && cargo clippy --all-targets --quiet -- -D warnings
    cd api && cargo test --quiet
    # The query cache must cover every query outside tests, so the API builds without a database, as deploys do. Not
    # `sqlx prepare --check`: the nullability it records depends on the data in whichever database it asks.
    cd api && SQLX_OFFLINE=true cargo check --workspace --quiet
    cd web && npm run --silent format:check
    cd web && npm run --silent lint
    cd web && npm run --silent typecheck
    cd web && npm run --silent api:check
    cd web && npm run --silent test
    cd web && npm run --silent test:ui

# One-time server setup for an environment (deploy/environments/<env>.env).
provision env:
    source deploy/environments/{{env}}.env && ssh "$SSH_TARGET" 'bash -s' < deploy/provision.sh

# Build locally and ship to an environment (deploy/environments/<env>.env).
deploy env:
    deploy/deploy.sh {{env}}

# Delete build output (Rust's target/ and Next's .next/). Safe any time; the next build recreates what it needs.
clean:
    cd api && cargo clean
    rm -rf web/.next
