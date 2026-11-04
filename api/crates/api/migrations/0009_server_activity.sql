-- Every heartbeat's player count, for the server activity chart. `server_heartbeats` keeps only the latest
-- per server; this keeps the history, for 30 days.
CREATE TABLE server_heartbeat_log (
    ip inet NOT NULL,
    port integer NOT NULL,
    players smallint NOT NULL CHECK (players >= 0),
    received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX server_heartbeat_log_received_at ON server_heartbeat_log (received_at);
