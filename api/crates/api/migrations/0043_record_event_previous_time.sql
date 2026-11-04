-- The player's best time on a run's board before that run, as it stood when the event was written, so servers
-- can announce an improvement without another request (`record_events.rs`). Null when they had none, and for
-- events written before this migration.
ALTER TABLE record_events ADD COLUMN previous_time float8;
