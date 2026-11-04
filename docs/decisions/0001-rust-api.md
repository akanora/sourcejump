# 0001 Rust for the API and background jobs
**Status:** accepted   **Date:** 2026-10-19
**Context:** The backend ingests runs from game servers, serves leaderboards and handles binary files: shavit replays, compression, BSP → web geometry, and later run verification from replay data. It shares a 4 GB VPS with Postgres and the web app. The code is written mostly by AI agents, so the toolchain should catch as many mistakes as possible before review.
**Decision:** Rust with axum (HTTP), tokio (async), sqlx (Postgres, queries checked at compile time, migrations), serde, utoipa (OpenAPI generated from code) and tracing. Background jobs run in the same binary.
**Rejected:**
- TypeScript (Fastify + Kysely): one language with the web app and familiar to the lead, but weaker at the binary/CPU work, heavier in memory, and its types are erased at runtime.
- Go: fine for the API, but no shared code with the browser via WebAssembly and a weaker type system.
**Consequences:** The replay parser is a Rust crate that also compiles to WebAssembly for the browser viewer. Builds are slower than in TypeScript; see 0005 for where builds run.
**Revisit if:** compile times or hiring community contributors become the main bottleneck.
