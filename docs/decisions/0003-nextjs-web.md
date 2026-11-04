# 0003 Next.js for the website, frontend only
**Status:** accepted   **Date:** 2026-10-19
**Context:** Links to maps, players and runs are shared on Discord, so pages need server-rendered metadata and preview images. The UI needs accessible primitives (dialogs, menus, tabs), micro-animations, and later a 3D replay viewer. The lead has used Next.js before.
**Decision:** Next.js (App Router, strict TypeScript, standalone build) with Tailwind, Radix primitives (owned in the repo, shadcn-style) and Motion. The web app never touches the database: all data comes from the Rust API through a client generated from its OpenAPI spec.
**Rejected:**
- SvelteKit: lighter, with good built-in transitions, but a smaller ecosystem for UI primitives and 3D (react-three-fiber).
- A client-only SPA: no server-rendered Discord previews.
- Next.js talking to Postgres directly: two places with business rules and two schemas to keep in sync.
**Revisit if:** Next.js's memory use or upgrade churn becomes a real problem on the VPS.
