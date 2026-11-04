# Records stream
A live feed of new records, so game servers can announce network records in chat and fetch a new record's replay for their bot. daf's rebuilt plugin already has both features, switched on by `features.stream_url` in the ruleset; his stand-in server (`beta.okwhiteli.st`, `example-api/server.py`) shows the behaviour. On the roadmap this is "live records feed", listed under later. Status: built and live on the beta; the ruleset switches it on.

## Decided
- Each record carries `has_replay`, true when `GET /v1/replays/{run_id}` serves it (done, 2026-11-02).
- Polling comes first; the lead asked for it on 2026-11-02 while daf reviews the handover.
- The plugin may require daf's `sjlink` extension, a ripext fork with an SSE client, in place of ripext (lead, 2026-11-02). So the stream is wanted. Open with daf: that plugins written for ripext keep working with `sjlink` loaded instead, and that its source and Linux and Windows builds are public.
- The API sets the shapes; the plugin adapts to them. daf's example is a reference, not the contract (`CLAUDE.md`).

## Open for the lead
- Whether servers replace their own replay bot with a network record automatically, or only on request. This is policy for the community; the blueprint says to fetch replays when someone asks. Either way the API side is the same.

## Design
- **One event log.** Table `record_events (id, tx, kind, run_id, created_at)`, where `tx` is the writing transaction's ID. It's written in the same transaction as the change it reports, so an event is never lost or sent early. Kinds:
  - `run`: a new personal best is stored.
  - `replay`: its replay is stored.
  - `invalidated`: staff invalidated a run that was on a board, so a server that copied its replay can drop it. A restored run that is a personal best again comes as `run`.
  Legacy runs never produce events. Rows older than 7 days are deleted by an hourly job.
- **Event data:** `id`, `kind`, `run_id`, `map`, `style`, `track`, `steamid64`, `name`, `time`, `tickrate`, `rank`, `has_replay`, `at`. `rank` is computed when the event is read, so a rank that later changed reads as it is now. `has_replay` follows the same rule as records.
- **Polling, `GET /v1/records/events?after=<cursor>&max_rank=<n>`** (built). At most 100 events, oldest first, plus `next` to send as `after`. With no `after`, it returns no events, only the current `next`, so a new client starts from now. Calling it every 10 to 30 s is cheap, works through any proxy, and needs only ripext.
- **Cursors** are `<tx>-<id>`, opaque to clients. A page only holds events from transactions older than the oldest still running (`pg_snapshot_xmin`), in (tx, id) order, so a transaction that took a lower ID but committed later is never skipped. Transaction IDs are cluster-wide: a long transaction anywhere delays events until it ends, and never drops them.
- **Stream, `GET /v1/records/stream?max_rank=<n>`** (built). Server-sent events over the same log: `id:` is the event's cursor, `event:` is the kind, and `data:` holds the JSON above. `Last-Event-ID` (or `after`) resumes; without either, the stream starts from now. A comment is sent every 15 s so proxies keep the connection open. One `LISTEN record_events` connection wakes every stream (the writers `NOTIFY` it), and each reads the log after its cursor with the polling query, so nothing is kept in memory and a restart loses nothing. Streams also look every 30 s unwoken, for notifications lost while the listener reconnects and events held back by an older transaction. At shutdown the listener stops and every stream ends, so they don't hold a deploy up.
- **Filters:** `max_rank` (default 1, at most 100), by rank now; `invalidated` events always come. No map filter until a client needs one: servers filter by map themselves. No key is needed. The data is already public on the site.
- **Ruleset:** migration 0035 publishes a new version with `features.record_events` and `features.record_stream` set to `true`. Features are switches (`BTreeMap<String, bool>`), not URLs: the paths are fixed and the plugin already knows the API's address. The migration copies each environment's current ruleset, since its zone source names its own host.

## Checks before shipping
- Caddy flushes `text/event-stream` responses without buffering. Make sure `encode zstd gzip` doesn't hold them back.
- Cloudflare Tunnel closes connections idle for about 100 s; the 15 s comment keeps them open. Test on the beta with a connection held for an hour.
- Load: one connection per game server, a few hundred at most. Each waits on one shared `LISTEN` connection, not one database connection each. Every wake (any new personal best) and every 30 s idle, each open stream makes two small indexed reads from the 10-connection pool: about 600 reads per wake at 300 servers, drained in tens of milliseconds. If servers grow into the thousands, one shared reader per wake fanning out to the streams makes that constant.

## Slices
| # | Slice | Status |
|---|---|---|
| 1 | Event log written by run ingest, replay storage and invalidation; polling endpoint; contract example | done |
| 2 | SSE stream over the log | done |
| 3 | Ruleset `features` entries; beta checks through Caddy and the tunnel | done: 150 s held with keep-alives every 15 s |
