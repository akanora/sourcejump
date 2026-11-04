-- The staff log is read a kind of action at a time, and about one thing (a player, map, run, key or server).
-- Both read newest first, so each index ends in the ID.
CREATE INDEX staff_log_action ON staff_log (action, id DESC);
CREATE INDEX staff_log_target ON staff_log (target, id DESC);
