@AGENTS.md

# web
Next.js frontend. It never talks to the database; all data comes from the Rust API (ADR 0003).
- Next.js here is newer than most training data: check `node_modules/next/dist/docs/` before using an API you're unsure of.
- Run commands through the root `justfile` (`just check`), or `npm run <script>` from `web/`.
- Pages render inside `Page` and link with `Link` (both `src/ui/`). Pages compose components from `src/ui/` (primitives) and `src/features/<feature>/` (domain). Visual values come only from design tokens (`docs/design-system.md`); lint fails on raw colors or arbitrary Tailwind values outside `src/ui/`.
- API calls go through `src/api/client.ts`. Its types are generated from `api/openapi.json` (`just openapi`); never edit `src/api/schema.ts` by hand.
- npm 11 drops the platform builds of rolldown and lightningcss from the lockfile when adding a dependency. Check `git diff package-lock.json` for removed `binding`/`lightningcss-*` entries and restore them before committing, or tests stop running.
