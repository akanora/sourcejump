-- What happened to records, for game servers that announce them and copy their replays (`record_events.rs`).
-- Each row is written in the transaction of the change it reports. `tx` is that transaction's ID: readers
-- only return rows from transactions older than every one still running, and page by (tx, id), so a row
-- that commits after a later-numbered one is never skipped.
CREATE TABLE record_events (
    id bigserial PRIMARY KEY,
    tx bigint NOT NULL DEFAULT pg_current_xact_id()::text::bigint,
    -- `run`: a new personal best. `replay`: its replay is stored. `invalidated`: staff took the run off the
    -- boards. A restored run that is a personal best again is reported as `run`.
    kind text NOT NULL CHECK (kind IN ('run', 'replay', 'invalidated')),
    run_id bigint NOT NULL REFERENCES runs (id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX record_events_order ON record_events (tx, id);
CREATE INDEX record_events_created_at ON record_events (created_at);
