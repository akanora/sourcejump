# Security

If you find a way to break SourceJump's rules (submit runs without a valid key, act as staff, read what isn't
public, get past a ban, take the site down), please report it privately, not in a public issue.

## How to report
Use **Report a vulnerability** on this repository's Security tab. Only the maintainers see it. Say what you
found, how to reproduce it, and what it lets someone do.

## Testing
- Run the API and site locally (`CLAUDE.md`) and test there. Local data is yours to break.
- Don't test against sourcejump.net or beta.sourcejump.net beyond what a normal visitor does: no load tests,
  no scans, nothing that touches other players' data.
- Don't use other people's API keys or sessions.

## Sensitive areas
API keys, Steam sign-in and sessions, staff permissions, bans and run invalidation, and storage upload links
are where a mistake costs the most; `CLAUDE.md` lists them and how they're meant to fail.
