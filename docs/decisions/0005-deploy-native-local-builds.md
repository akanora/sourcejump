# 0005 Native services on the VPS, built on the dev machine
**Status:** accepted   **Date:** 2026-10-19
**Context:** The VPS has 2 cores and 4 GB of RAM, which is too small to compile Rust or build Next.js comfortably. The lead doesn't want to depend on GitHub Actions minutes for a private repo. The dev machine runs Linux on x86_64, the same architecture as the VPS.
**Decision:**
- `just deploy` builds on the dev machine and copies the result over SSH.
- The API is built as a static binary (`x86_64-unknown-linux-musl`), so it runs regardless of the VPS's system libraries.
- The web app ships as Next.js `standalone` output and runs on Node.
- Postgres and Caddy (TLS, reverse proxy) are installed from apt. Each service is a systemd unit.
- Cloudflare provides DNS and a proxy in front. A nightly `pg_dump` goes to object storage.
**Rejected:**
- Docker Compose: one more layer to learn and run, and images would still need building somewhere. Native packages plus one static binary are simpler on a single box.
- Building in GitHub Actions: costs CI minutes on a private repo and isn't needed by a solo lead.
**Revisit if:** more people deploy, or a second server is added. CI that runs `just check` on pull requests can be added once others contribute.
