# Staff rework
From the lead's review of the staff area (2026-10-21). Staff tools move onto the pages they act on; the staff area keeps only Logs and API keys. One area at a time: a mockup, the lead's OK, then build and review. A `/staff` section is deleted once its in-place replacement works.

## Decisions (lead, 2026-10-21)
- No disclosure triangles (`<details>`, collapsibles) anywhere. Present the content well instead.
- Log rows: who, what happened, how long ago (exact time on hover), and the reason when there is one. One sentence per row (mockup C).
- Rules leave the staff tools. The ruleset stays stored and versioned (runs carry its version), but changes ship as code (migrations), not through a UI. The public `/ruleset` page explains what's enforced. This changes the "policy is data" hard rule for the ruleset and the `servers` and `replays` policies; update `CLAUDE.md` and `domain.md` in that step.
- A server holds one key at a time. Issuing a new key revokes the old one in the same step, and its runs stay valid; invalidating them stays a separate action.
- Server activity storage stays as it is: listed servers' heartbeats for 30 days, daily totals for 400 days, pruned as heartbeats arrive.

## Order
| # | Area | Status |
|---|---|---|
| 1 | Logs: `/staff` is the log, paged newer and older; overview, "Your privileges" and `/staff/log` removed | done |
| 2 | API keys: one table (mockup A), one key per server (database constraint), replace on issue, runs counted and invalidated per server | done |
| 3 | Rules: remove the editor, its publish endpoints and the section; doc and hard-rule update. `manage_ruleset` retired (bit 1 reserved) | done |
| 4 | Servers: on `/servers`, staff also see unlisted, quiet and never-heard servers, unlisted dimmed (mockup A): an eye toggles listing, an info dialog holds compliance, versions, plugins, key and listing. `/staff/servers` removed | done |
| 5 | Posts: removed posts in place on `/community` for staff (mockup A), dimmed, with who, when, why and Restore where allowed; a removed post's page shows it to staff. New post, Edit and Remove load in the browser. `/staff/posts` removed | done |
| 6 | Runs: the run dialog shows public details and links to `/runs/{id}`; that page has a staff card under the details (mockup B): the run's log and Invalidate or Restore. `/staff/runs` stays until step 7 moves bulk invalidation to players | done |
| 7 | Players: a Profile / Manage switch; `/players/{id}/manage` has cards for bans, runs (invalidations still holding runs, with Restore), privileges and the player's log (mockup A). Any SteamID opens it ("Manage … anyway" on a search). Bans list: a staff Banned tab on `/players`. A server's invalidations restore on API keys. `/staff/players` and `/staff/runs` removed | done |
| 8 | Maps: a Map / Manage switch; `/maps/{map}/manage` has cards (mockup A) for the description, tracks (zones by type, tier picker), zone sets and the map's log, with Change image and Move banner on the banner. Up to 10 pictures, uploaded and processed by the API (16:9, 1920×1080 and 480×270 WebP); the first is the cover, and clicking the banner shows them all whole with miniatures (lead 2026-10-23). Maps without runs: a staff tab on `/maps`. `/staff/maps` removed; the tier history's disclosure went to the log | done |
| 9 | Zone editor: in the browser over the map's BSP (lead picked it, 2026-10-24), built as replay slice 8d: "Edit in 3D" on Zone sets | done |

With 2–8 done, the staff nav is Logs and API keys. Staff don't get a list of their own privileges; the tools they hold simply show (lead, 2026-10-23).

## Notes
- Staff controls on public pages load in the browser for signed-in staff, so the public pages stay cacheable; the API checks every privilege as before.
- The log's `target` and `detail` aren't shown as fields, but they let run, player and map pages show their own log entries (steps 6–8).
- Map and player pages keep their header in a route layout; the Map / Manage and Profile / Manage switch only swaps the view beneath it (lead, 2026-10-23).
- The map's Manage view will get a Points section once the community decides how points work, and possibly a Download section; whether SourceJump hosts FastDL waits on its cost (lead, 2026-10-23). The zone editor (step 9) will share the replay viewer's technology and gets its own session.
