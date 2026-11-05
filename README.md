# SourceJump 2.0

The global records database for the Counter-Strike: Source bunnyhop community: the API that game servers submit runs to, and the sourcejump.net website where players follow leaderboards, profiles, maps, servers and replays.

A public beta runs at [beta.sourcejump.net](https://beta.sourcejump.net). Its data is wiped when 2.0 replaces the current site.

## Where to start

- **Plugin and tool developers:** [`docs/api.md`](docs/api.md) describes everything a game server does: API keys, submitting runs, retries, heartbeats, replays and zones. The schema is [`api/openapi.json`](api/openapi.json), with example requests in [`api/contract/`](api/contract/).
- **What the project is for:** [`docs/VISION.md`](docs/VISION.md), and the work order in [`docs/ROADMAP.md`](docs/ROADMAP.md).
- **Terms, and who decides what:** [`docs/domain.md`](docs/domain.md). Gameplay and policy (ranked styles, maps, tiers, points) are decided by the community on Discord, not in this repo.
- **Why the stack is what it is:** [`docs/decisions/`](docs/decisions/).
- **Running it locally and project conventions:** [`CLAUDE.md`](CLAUDE.md).

## Layout

| Folder | What it is |
|---|---|
| `api/` | The HTTP API and background jobs, in Rust, on PostgreSQL |
| `web/` | The website, in Next.js. It reads all data through the API |
| `deploy/` | Server setup and deploy scripts |
| `docs/` | API reference, design notes and decisions |

## Related repositories

- [sourcejump-packer](https://github.com/sourcejump/sourcejump-packer): turns maps into the files the replay viewer loads, and `sj-pack`, the tool staff use to pack folders of maps.
- [sourcejump-plugin](https://github.com/stackedgamer/sourcejump-plugin): the SourceMod plugin's spec and the community's decisions.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md), and [`SECURITY.md`](SECURITY.md) to report a security problem.

## License

MIT, see [`LICENSE`](LICENSE). The replay viewer's renderer under `web/src/features/replays/viewer/noclip/` comes from [noclip.website](https://github.com/magcius/noclip.website) and keeps its own MIT license and notice.
