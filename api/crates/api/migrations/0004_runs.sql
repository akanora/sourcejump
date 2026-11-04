-- Runs submitted by keyed servers, the players and maps they reference, personal bests, and the replays
-- SourceJump asked for.

CREATE TABLE players (
    steamid64 bigint PRIMARY KEY,
    -- The name from the most recently finished run, so a run sent late from a queue can't roll it back.
    name text NOT NULL,
    name_seen_at timestamptz NOT NULL
);

CREATE TABLE maps (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Lowercase, as shavit reports it.
    name text NOT NULL UNIQUE CHECK (name = lower(name) AND name <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    server_id bigint NOT NULL REFERENCES servers (id),
    -- The key the run came with, so revoking a key can find every run sent with it.
    key_id bigint NOT NULL REFERENCES server_keys (id),
    -- The ID the game server gave the run. A server resending a run is how every run is counted once.
    server_run_id text NOT NULL,
    player_steamid64 bigint NOT NULL REFERENCES players (steamid64),
    player_name text NOT NULL,
    map_id bigint NOT NULL REFERENCES maps (id),
    -- A style key from the run's ruleset, never a server's style number.
    style text NOT NULL,
    track smallint NOT NULL CHECK (track >= 0),
    time double precision NOT NULL CHECK (time > 0),
    jumps integer NOT NULL CHECK (jumps >= 0),
    strafes integer NOT NULL CHECK (strafes >= 0),
    sync real NOT NULL CHECK (sync BETWEEN 0 AND 100),
    perfs real NOT NULL CHECK (perfs BETWEEN 0 AND 100),
    avg_velocity real NOT NULL CHECK (avg_velocity >= 0),
    max_velocity real NOT NULL CHECK (max_velocity >= 0),
    tickrate real NOT NULL CHECK (tickrate > 0),
    -- The game server's clock; `received_at` is ours.
    finished_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    plugin_version text NOT NULL,
    ruleset_version integer NOT NULL REFERENCES rulesets (version),
    zone_fingerprint text NOT NULL,
    compliance jsonb NOT NULL,
    UNIQUE (server_id, server_run_id)
);

CREATE INDEX runs_player ON runs (player_steamid64);
CREATE INDEX runs_key ON runs (key_id);

-- Each player's fastest run per map, style and track. Kept in step with `runs` by the ingest; leaderboard
-- ranks are read from here with window functions.
CREATE TABLE personal_bests (
    player_steamid64 bigint NOT NULL REFERENCES players (steamid64),
    map_id bigint NOT NULL REFERENCES maps (id),
    style text NOT NULL,
    track smallint NOT NULL,
    run_id bigint NOT NULL UNIQUE REFERENCES runs (id),
    -- Copied from the run so leaderboards sort on this table's index alone.
    time double precision NOT NULL,
    PRIMARY KEY (player_steamid64, map_id, style, track)
);

CREATE INDEX personal_bests_leaderboard ON personal_bests (map_id, style, track, time);

-- Community policy that isn't part of the plugin's ruleset, versioned the same way: a change is a new
-- version, and the newest version per name is in force.
CREATE TABLE policies (
    name text NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    value jsonb NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (name, version)
);

CREATE FUNCTION policies_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'policy % version % is immutable; publish a new version instead', OLD.name, OLD.version;
END;
$$;

CREATE TRIGGER policies_immutable
    BEFORE UPDATE OR DELETE ON policies
    FOR EACH ROW EXECUTE FUNCTION policies_reject_change();

-- Lead's decision, 2026-10-19: ask for a run's replay only when it's a new SourceJump personal best.
INSERT INTO policies (name, version, value) VALUES ('replays', 1, '{"request": "new_personal_best"}');

-- Replays SourceJump asked a server to upload. The file goes straight to object storage under `object_key`.
CREATE TABLE replays (
    run_id bigint PRIMARY KEY REFERENCES runs (id),
    object_key text NOT NULL UNIQUE,
    requested_at timestamptz NOT NULL DEFAULT now()
);
