# SourceJump 2.0 website & API
The new sourcejump.net: the global records database and website for the CS:S bunnyhop community. Game servers submit runs to the API, and players browse leaderboards, profiles, maps, servers and replays. Intent: `docs/VISION.md`. Work order: `docs/ROADMAP.md`. Domain terms and who decides what: `docs/domain.md`.

Code is written mostly by AI agents, but future contributors will read it. Write clean, well-structured code a newcomer can follow. When readability and a sound design pull apart, choose the sound design and explain it in a comment; never the clever-but-obscure one. Docs, strict types and tests carry the rest, so keep all three honest.

## Commands
- check (docs budget, format, lint, types, tests): `just check`
- run locally (local S3 on :3900, API on :8080, web on :3000): `just dev`. First time: copy `.env.example` to `.env`, then `just setup` and `just db` (database, migrations, sample data). Server API keys: `cd api && cargo run -- keys issue "<name>"`
- after changing API routes, types or queries: `just openapi` (spec, web types, sqlx query cache)
- format everything: `just fmt`. Free build space: `just clean`. Ship: `just deploy <env>` (`docs/deploy.md`)
- Prerequisites: rustup (the toolchain is pinned in `api/rust-toolchain.toml`), Node 24, `just`, PostgreSQL 18, `cargo install sqlx-cli --no-default-features --features postgres`, and [Garage](https://garagehq.deuxfleurs.fr/download/) on the PATH for local S3. Deploying also needs `musl-tools`.

## Layout
- `api/` — Cargo workspace. `crates/api` is the HTTP server and background jobs, organized by feature (`runs.rs`/`runs/`, `players/`, …), with tests next to code. `crates/api/migrations/` is the schema; `api/openapi.json` and `api/.sqlx/` are generated and committed.
- `web/` — Next.js frontend; has its own `CLAUDE.md`.
- `deploy/` — Caddyfile, systemd units, provision and deploy scripts, per-environment settings.
- `docs/` — VISION, ROADMAP, domain, deploy, design-system, `decisions/` (ADRs), `plans/` (temporary), `design/` (reference images).
- `scripts/` — repo scripts (doc budget, the home header's depth map).

## Where to look
- API behavior for game servers and every client (keys, idempotency, retry rules, heartbeats, replays, zones): `docs/api.md`. The website's endpoints (sign-in, players, maps, server list, posts): `docs/site-api.md`; the staff tools': `docs/staff-api.md`. Schema: `api/openapi.json`; examples: `api/contract/`.
- Plugin ↔ API: this repo designs the API; the plugin (`sourcejump/plugins`, private for now) adapts to it. Community decisions (policy) are recorded in `docs/domain.md` and win. Don't edit the plugin repo; it's updated to match with the lead's OK.
- Why the stack is what it is: `docs/decisions/` (0001 Rust, 0002 Postgres, 0003 Next.js, 0004 monorepo, 0005 deploy, 0006 file storage, 0007 Cloudflare R2, 0008 Cloudflare Tunnel).
- Servers, environments, shipping: `docs/deploy.md`.
- UI work: `docs/design-system.md` (tokens, primitives, motion, screenshot tests); see it at `/dev/ui`.
- Multi-session work in progress: `docs/plans/`.

## Hard rules
- **Never invent a community decision.** Ranked styles, maps, tiers, points, replay policy and cvars are the community's call (`docs/domain.md`); leave an undecided value open. Once decided, the ruleset and policies are versioned data that change in code, as a migration (lead, 2026-10-21); per-map data such as tiers is edited by staff on the site.
- **Every run is counted once.** Run IDs come from the game server; ingest must be idempotent.
- **Legacy (pre-2.0) runs never count toward 2.0 standings.** Boards show 2.0 runs by default; "2.0 + pre-2.0" and "Pre-2.0" are views to switch to, with legacy runs marked. WRs, WR history, points and 2.0 ranks never include them (lead, 2026-10-26).
- The web app never touches the database; all data goes through the API.
- Sensitive areas, fail closed and review carefully: API keys, Steam sign-in and sessions, staff permissions, bans and run invalidation, presigned storage URLs.
- No secrets in the repo, logs or URLs. Local config goes in `.env`, which is gitignored.
- User-facing text: plain and factual. No slogans or sales copy.
- Docs change in the same commit as the code they describe. `just check` runs the doc-budget check.

## Engineering standard
- Smallest design that meets stated needs; abstract at the third real use. Search for reusable code before writing.
- Organize by feature. Use the same word across layers (table, type, route, component). No utils/helpers/common dumping grounds.
- Each file opens with a one-line purpose comment; comments explain why, never what.
- Strict types. Validate external input once at the boundary (API request types, the generated web client).
- Every new dependency needs a stated, concrete benefit.
- Database migrations are forward-only and additive where possible.
- Nothing is done until `just check` passes and the change has been run and observed (endpoint called, page opened).
- Commit small, coherent changes with messages that explain intent.
