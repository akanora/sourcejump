# 0004 One repo for API, web and shared crates
**Status:** accepted   **Date:** 2026-10-19
**Context:** The API's types, the web client generated from them, and the replay parser used on both sides change together.
**Decision:** One private repo: `api/` (Cargo workspace), `web/` (npm), `docs/`, `deploy/`, with a root `justfile` for `dev`, `check` and `deploy`. Plain npm, which is already installed, rather than pnpm. The SourceMod plugin stays in its own public repo (`sourcejump-plugin`). The OpenAPI spec and contract tests against the plugin's mock keep the two in step.
**Rejected:**
- Separate API and web repos: every contract change becomes two coordinated commits.
- Folding the plugin in: it's public, GPL and built by a different toolchain.
**Revisit if:** only part of it should be public. Update 2026-11-05: the whole repo goes public under MIT, with `sourcejump-packer`; one repo still fits.
