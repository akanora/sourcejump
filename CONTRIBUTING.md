# Contributing

Thanks for helping. SourceJump is the CS:S bunnyhop community's global records site; this repo is its API
and website.

## Before you start
- **Gameplay and policy are decided by the community on Discord, not in pull requests:** ranked styles,
  maps, tiers, points, replay policy and cvars (`docs/domain.md`). Code may leave an undecided value open; it
  never picks one.
- For anything bigger than a fix, open an issue first, so the design can be agreed before you build it.
- Security problems go through `SECURITY.md`, not issues.

## Working on it
- Setup, commands and conventions are in `CLAUDE.md`; what each part does is in `docs/`.
- Keep changes small and focused, with commit messages that say why.
- Change the docs in the same commit as the code they describe.
- Run `just check` before opening a pull request. CI runs the same checks, apart from the style guide
  screenshots.

## License
Contributions are under the MIT license (`LICENSE`), like the rest of the repo.
