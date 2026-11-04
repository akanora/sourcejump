-- Points per personal best, and each player's totals, stored so leaderboards only read them. They're
-- recounted where they change (`leaderboards/standings.rs`): a board when a personal best on it changes, as
-- a new world record moves everyone's speed points there; everything when the formula or tiers change.

-- The formula's shape. Its numbers are the `points` policy (`policies.rs`): a map is worth `base` at tier 1,
-- times `growth_percent` each tier up, a bonus `bonus_percent` of that; finishing earns `finish_percent` of
-- the value and the rest is earned by speed, as (world record ÷ time) ^ `speed_exponent`.
CREATE FUNCTION points_for(
    tier smallint, run_time double precision, world_record double precision, bonus boolean,
    base double precision, growth_percent double precision, finish_percent double precision,
    speed_exponent double precision, bonus_percent double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN base * power(growth_percent / 100, tier - 1)
       * CASE WHEN bonus THEN bonus_percent / 100 ELSE 1 END
       * (finish_percent / 100 + (1 - finish_percent / 100) * power(world_record / run_time, speed_exponent));

ALTER TABLE personal_bests ADD COLUMN points double precision NOT NULL DEFAULT 0;

-- Per style, main tracks and bonuses apart: a player's points and finished tracks. Players with none have no row.
CREATE TABLE standings (
    style text NOT NULL,
    bonus boolean NOT NULL,
    player_steamid64 bigint NOT NULL REFERENCES players (steamid64),
    points double precision NOT NULL,
    completed integer NOT NULL CHECK (completed > 0),
    PRIMARY KEY (style, bonus, player_steamid64)
);
CREATE INDEX standings_by_points ON standings (style, bonus, points DESC);
CREATE INDEX standings_by_completed ON standings (style, bonus, completed DESC);

-- The same for legacy records (one style, main tracks), counted on the old site's tiers. Players banned from
-- records are left out, and their runs set no world record.
CREATE TABLE legacy_standings (
    player_steamid64 bigint PRIMARY KEY REFERENCES legacy_players (steamid64),
    points double precision NOT NULL,
    completed integer NOT NULL CHECK (completed > 0)
);
CREATE INDEX legacy_standings_by_points ON legacy_standings (points DESC);
CREATE INDEX legacy_standings_by_completed ON legacy_standings (completed DESC);

-- What the stored points were counted with: the formula's numbers and whether tiers were in force. The API
-- recounts everything at startup when the formula in force differs, so a migration or a new draft needs no
-- manual step.
CREATE TABLE standings_formula (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    formula jsonb NOT NULL
);
