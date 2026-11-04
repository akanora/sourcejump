-- A map holds up to 10 pictures in an order staff choose; the first is its cover, shown as the banner and in
-- lists. Each picture keeps the strip a short banner shows of it, so any of them can become the cover.
CREATE TABLE map_images (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    map_id bigint NOT NULL REFERENCES maps (id),
    -- The stored image's key without its size suffix, as `maps.image_key` was.
    key text NOT NULL UNIQUE CHECK (key ~ '^maps/[a-z0-9_.-]+/[0-9a-f]{12}$'),
    -- 0 is the cover. With the unique order below, this also caps a map at 10 pictures.
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
    -- Which horizontal strip a short banner shows: 0 the top, 100 the bottom.
    focus smallint NOT NULL DEFAULT 50 CHECK (focus BETWEEN 0 AND 100),
    added_at timestamptz NOT NULL DEFAULT now(),
    -- NULL when added from the command line.
    added_by bigint REFERENCES players (steamid64),
    -- Checked at commit, so a reorder can move pictures through each other's places in one transaction.
    CONSTRAINT map_images_order UNIQUE (map_id, position) DEFERRABLE INITIALLY DEFERRED
);

INSERT INTO map_images (map_id, key, position, focus)
SELECT id, image_key, 0, image_focus FROM maps WHERE image_key IS NOT NULL;

ALTER TABLE maps DROP COLUMN image_key, DROP COLUMN image_focus;
