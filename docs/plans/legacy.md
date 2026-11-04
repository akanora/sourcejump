# Legacy records and the ban list
Roadmap slice 9. The old sourcejump.net's records come over as pre-2.0, apart from 2.0's, and its ban list carries over. Its database is MySQL 8; the importer reads a `mysqldump` (one file per table: `sj_maps.sql`, `sj_players.sql`, `sj_times.sql`) directly, so no MySQL is needed. The dump holds personal data: it stays off the repo, and so do samples of it.

## Decided (lead, 2026-10-26)
- Every run the old site kept is imported, not just personal bests. Runs it marked invalid are dropped.
- Server hostnames, players' country, avatar and setup fields come over; server IPs don't.
- Each old ban becomes a 2.0 ban from records and posting, until lifted, dated as the old one; reasons are kept. Staff privileges don't carry over: the lead grants them again.
- The old site had no styles, zones or kept replays.

## Steps
| # | Step | Status |
|---|---|---|
| 9a | Import: `legacy_maps`, `legacy_players`, `legacy_runs`; `sourcejump-api legacy import <dump folder>`; bans carried over and logged ("carried over from the old site") | done |
| 9b | Legacy records on the boards and on profiles (lead picked mockup A: the view switch beside Style, the Pre-2.0 badge) | done |

## 9a in short
- One transaction. A rerun replaces the legacy tables and skips bans carried over before (their log entry's detail has `legacy: true`), which is how the final dump at the switch is read. A carried-over ban also takes the player's 2.0 runs off the boards, as a staff ban can.
- From the test dump: 6,717 maps, 8,460 players, 377,879 runs, 385 bans. Left out, and counted by the command: 7 map names a map can't have (57 runs), 281 rows that aren't individual Steam accounts or repeat one, 2,940 invalid runs, 202 runs with a time of 0.
- Legacy tiers and points are the old site's, kept in `legacy_maps`; 2.0 tiers are assigned afresh.
- The old site's record (`wr_id`) is usually the map's fastest run. Where it isn't, the faster run is nearly always a banned player's, so legacy boards should leave banned players out the way the old site did (9b).

## Decided for 9b (lead, 2026-10-26)
- One board per map. By default it shows 2.0 runs only; "2.0 + pre-2.0" (both together, ranked by time) and "Pre-2.0" are views to switch to. Legacy runs carry a small mark.
- Those views are for display. WRs, WR history, points and 2.0 ranks count 2.0 runs only.
- The old site had no styles or bonuses, so its runs belong on the normal style's main track. Other boards have no legacy views.
- Legacy boards leave banned players out, as the old site did.
- One profile per player, `/players/{steamid64}`, the same page for everyone. Their legacy runs show there, marked the same way as on boards. A player with only legacy runs has that same profile.

## 9b in short
- A board or profile with no 2.0 runs in the normal style opens on Pre-2.0 rather than an empty list; a profile's legacy rows link to the map's Pre-2.0 view.
- The combined view keeps one row per player, so a 2.0 WR holder with a faster old run shows their old run there.

## Open
- Whether setup fields (the old profile's free-text mouse, DPI, sensitivity, monitor and keyboard) show on profiles. Kept but hidden until decided.
