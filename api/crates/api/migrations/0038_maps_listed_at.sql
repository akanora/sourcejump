-- When each map joined the map list: when SourceJump received its first run. The list's "Newest" sort and its
-- newest maps read it. Not `created_at`, which a zone import also sets for maps nobody has run.
ALTER TABLE maps ADD COLUMN listed_at timestamptz;

UPDATE maps SET listed_at = (SELECT min(received_at) FROM runs WHERE runs.map_id = maps.id)
WHERE last_run_at IS NOT NULL;

CREATE INDEX maps_listed_at ON maps (listed_at);
