-- Map pages: when each map was last run, an optional image, staff-assigned tiers, and the index that map
-- pages and WR history read runs through.

ALTER TABLE maps
    -- The newest `finished_at` of the map's runs; NULL until its first run. Kept by the ingest, so the map
    -- list can sort by activity without scanning every run.
    ADD COLUMN last_run_at timestamptz,
    -- Shown on map rows and the map's page. Set by staff; NULL shows a placeholder.
    ADD COLUMN image_url text CHECK (image_url LIKE 'https://%');

UPDATE maps SET last_run_at = (SELECT max(finished_at) FROM runs WHERE runs.map_id = maps.id);

CREATE INDEX maps_last_run_at ON maps (last_run_at);

-- For one map, style and track: runs in the order they finished (WR history), and counts per map.
CREATE INDEX runs_map ON runs (map_id, style, track, finished_at);

-- Tiers per map and track, assigned by staff. The tier count is the `tiers` policy (`{"count": N}`); both are
-- community decisions, so neither has a value until staff set one. Append-only like other policy: the
-- newest assignment per map and track is in force, and older ones are the history.
CREATE TABLE map_tiers (
    map_id bigint NOT NULL REFERENCES maps (id),
    track smallint NOT NULL CHECK (track >= 0),
    tier smallint NOT NULL CHECK (tier > 0),
    assigned_at timestamptz NOT NULL DEFAULT now(),
    -- The staff member who assigned it; NULL when set from the development CLI.
    assigned_by bigint REFERENCES players (steamid64),
    PRIMARY KEY (map_id, track, assigned_at)
);

CREATE FUNCTION map_tiers_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'tier assignments are history; assign a new tier instead';
END;
$$;

CREATE TRIGGER map_tiers_immutable
    BEFORE UPDATE OR DELETE ON map_tiers
    FOR EACH ROW EXECUTE FUNCTION map_tiers_reject_change();
