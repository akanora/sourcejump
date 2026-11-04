-- Zone sets per map, in the JSON array format shavit-zones-json loads. Versioned like rulesets: a published
-- set never changes, and the newest version is the one servers load.
CREATE TABLE map_zones (
    map_id bigint NOT NULL REFERENCES maps (id),
    version integer NOT NULL CHECK (version > 0),
    zones jsonb NOT NULL CHECK (jsonb_typeof(zones) = 'array'),
    published_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (map_id, version)
);

CREATE FUNCTION map_zones_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'zone set version % of map % is immutable; publish a new version instead', OLD.version, OLD.map_id;
END;
$$;

CREATE TRIGGER map_zones_immutable
    BEFORE UPDATE OR DELETE ON map_zones
    FOR EACH ROW EXECUTE FUNCTION map_zones_reject_change();

-- Anti-cheat detections forwarded by keyed servers. Not public. Idempotent per server like runs, since the
-- plugin resends what it couldn't deliver.
CREATE TABLE anticheat_detections (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    server_id bigint NOT NULL REFERENCES servers (id),
    key_id bigint NOT NULL REFERENCES server_keys (id),
    server_detection_id text NOT NULL,
    player_steamid64 bigint NOT NULL REFERENCES players (steamid64),
    player_name text NOT NULL,
    map_id bigint NOT NULL REFERENCES maps (id),
    -- What the anti-cheat reported, as text.
    message text NOT NULL,
    detected_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (server_id, server_detection_id)
);

CREATE INDEX anticheat_detections_player ON anticheat_detections (player_steamid64);
