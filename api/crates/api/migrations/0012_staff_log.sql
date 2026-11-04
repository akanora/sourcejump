-- The staff log: every staff action, who took it, and why. Written in the same transaction as the change it
-- records, so the log and the data can't disagree. Append-only: a mistake is corrected by a new action.
CREATE TABLE staff_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- The staff member; NULL for actions taken with the server's command line.
    actor_steamid64 bigint REFERENCES players (steamid64),
    -- What was done, such as `grant_privileges`. The API's `StaffAction` names them.
    action text NOT NULL CHECK (action ~ '^[a-z_]+$'),
    -- What it was done to: a SteamID64, key prefix, run ID, map name or address, depending on the action.
    target text NOT NULL,
    reason text CHECK (length(reason) BETWEEN 1 AND 500),
    -- The specifics, such as the privileges granted. Its shape depends on the action.
    detail jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail) = 'object'),
    at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX staff_log_actor ON staff_log (actor_steamid64);

CREATE FUNCTION staff_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'the staff log is append-only';
END;
$$;

CREATE TRIGGER staff_log_immutable
    BEFORE UPDATE OR DELETE ON staff_log
    FOR EACH ROW EXECUTE FUNCTION staff_log_reject_change();
