-- Records from the old sourcejump.net (pre-2.0), imported from its database dump with `legacy import`. They
-- live apart from the 2.0 tables and never mix into 2.0 leaderboards. An import replaces all three tables, so
-- the final dump at the switch is read the same way as a test dump. IDs are the old site's own.

CREATE TABLE legacy_maps (
    id integer PRIMARY KEY,
    name text NOT NULL UNIQUE CHECK (name = lower(name) AND name <> ''),
    -- The old site's tier; NULL where it was never set (0 there). Not a 2.0 tier: those are the community's
    -- and are assigned again in `map_tiers`.
    tier smallint CHECK (tier > 0),
    points integer NOT NULL,
    -- The run the old site showed as the record, and the one before it; NULL when that run wasn't imported.
    wr_run_id integer,
    old_wr_run_id integer
);

CREATE TABLE legacy_players (
    steamid64 bigint PRIMARY KEY,
    name text NOT NULL,
    alias text,
    avatar_url text CHECK (avatar_url LIKE 'https://%'),
    country_code text CHECK (country_code ~ '^[A-Z]{2}$'),
    -- The setup players filled in on their old profile, as they typed it.
    setup_mouse text,
    setup_mouse_pad text,
    setup_dpi text,
    setup_sens text,
    setup_monitor text,
    setup_aspect text,
    setup_keyboard text
);

-- Every run the old site kept, not just personal bests: up to 129 per player and map. Runs it marked invalid
-- aren't imported (lead, 2026-10-26). The old site had no styles; its runs are auto-bhop on the main track.
CREATE TABLE legacy_runs (
    id integer PRIMARY KEY,
    map_id integer NOT NULL REFERENCES legacy_maps (id),
    player_steamid64 bigint NOT NULL REFERENCES legacy_players (steamid64),
    player_name text NOT NULL,
    -- The server's name then. Its IP isn't imported (lead, 2026-10-26).
    server_hostname text NOT NULL,
    time double precision NOT NULL CHECK (time > 0),
    sync real NOT NULL,
    strafes integer NOT NULL,
    jumps integer NOT NULL,
    -- NULL for the few dates the old site stored in a form we can't read.
    finished_at timestamptz,
    -- The old site's `initial_record` flag, kept as it was. Many of these runs are dated before the old site
    -- existed, so it likely marks runs taken from servers' own databases at its start.
    initial_record boolean NOT NULL,
    -- A video ID as typed on the old site, mostly YouTube's.
    video text
);

CREATE INDEX legacy_runs_board ON legacy_runs (map_id, time);
CREATE INDEX legacy_runs_player ON legacy_runs (player_steamid64);
