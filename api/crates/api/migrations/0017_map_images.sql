-- Map images are uploaded to SourceJump, processed into fixed WebP sizes and kept in object storage
-- (ADR 0006). They replace links to images elsewhere; no site has been deployed, so the old column goes.
-- Maps also get a public description, set by staff.
ALTER TABLE maps
    DROP COLUMN image_url,
    -- The stored image's key without its size suffix, such as `maps/bhop_forest/3fa9c2b1d0e4`; its files are
    -- `<key>-1920.webp` and `<key>-480.webp`. The hash is of the image, so a new one gets a new address.
    ADD COLUMN image_key text CHECK (image_key ~ '^maps/[a-z0-9_.-]+/[0-9a-f]{12}$'),
    -- Which horizontal strip of the 16:9 image the map page's banner shows: 0 the top, 100 the bottom.
    ADD COLUMN image_focus smallint NOT NULL DEFAULT 50 CHECK (image_focus BETWEEN 0 AND 100),
    ADD COLUMN description text CHECK (length(description) BETWEEN 1 AND 1000);
