-- Per-server daily totals of listed servers' heartbeats, for the activity chart's year view. A year of raw
-- heartbeats would be read on every view; this is one row per server per day. Days are UTC.
CREATE TABLE server_activity_daily (
    day date NOT NULL,
    ip inet NOT NULL,
    port integer NOT NULL,
    -- The players reported by each heartbeat that day, summed; with `heartbeats`, the day's average.
    players_sum bigint NOT NULL CHECK (players_sum >= 0),
    heartbeats integer NOT NULL CHECK (heartbeats > 0),
    PRIMARY KEY (day, ip, port)
);
