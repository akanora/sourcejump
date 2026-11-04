-- Bans: what a player may not do, why, who decided it, and until when. A player's restrictions are those of
-- their active bans (not lifted, not past `ends_at`), so a ban ends on its date without a job;
-- `players.restrictions` stays unused. Each ban is also in the staff log, whose entry runs stored during the
-- ban name in `runs.invalidated_by`.
CREATE TABLE bans (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_steamid64 bigint NOT NULL REFERENCES players (steamid64),
    -- A bitmap; bit positions are defined in restrictions.rs and never renumbered or reused.
    restrictions bigint NOT NULL CHECK (restrictions <> 0),
    reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    -- NULL when banned with the server's command line.
    banned_by bigint REFERENCES players (steamid64),
    banned_at timestamptz NOT NULL DEFAULT now(),
    -- NULL: until lifted.
    ends_at timestamptz CHECK (ends_at > banned_at),
    log_id bigint NOT NULL UNIQUE REFERENCES staff_log (id),
    lifted_at timestamptz,
    lifted_by bigint REFERENCES players (steamid64),
    lift_reason text CHECK (length(lift_reason) BETWEEN 1 AND 500),
    CHECK ((lifted_at IS NULL) = (lift_reason IS NULL)),
    CHECK (lifted_at IS NOT NULL OR lifted_by IS NULL)
);

CREATE INDEX bans_player ON bans (player_steamid64);

-- A ban is changed only by lifting it, once. Anything else is refused, so its history can't be rewritten.
CREATE FUNCTION bans_only_lift() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.lifted_at IS NULL AND NEW.lifted_at IS NOT NULL
       AND (NEW.id, NEW.player_steamid64, NEW.restrictions, NEW.reason, NEW.banned_by, NEW.banned_at, NEW.ends_at,
            NEW.log_id)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.player_steamid64, OLD.restrictions, OLD.reason, OLD.banned_by, OLD.banned_at, OLD.ends_at,
            OLD.log_id) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ban % can only be lifted, once', OLD.id;
END;
$$;

CREATE TRIGGER bans_lift_only
    BEFORE UPDATE OR DELETE ON bans
    FOR EACH ROW EXECUTE FUNCTION bans_only_lift();
