-- Each map's file for the web viewer: the map stripped to what the viewer reads and brotli-compressed
-- (`maps/viewer_file.rs`). One row per map once SourceJump has tried to make it.

CREATE TABLE map_viewer_files (
    map_id bigint PRIMARY KEY REFERENCES maps (id),
    -- The stored file; its name holds a hash of its bytes, so it never changes. NULL until one is made.
    object_key text UNIQUE,
    -- The map as fetched (.bsp), stripped, and as stored (brotli), in bytes.
    source_bytes bigint CHECK (source_bytes > 0),
    stripped_bytes bigint CHECK (stripped_bytes > 0),
    stored_bytes bigint CHECK (stored_bytes > 0),
    made_at timestamptz,
    -- The last attempt that failed, and why. A map that already has a file keeps it.
    failed_at timestamptz,
    failed_reason text,
    CONSTRAINT map_viewer_files_made_together CHECK (
        (object_key IS NULL) = (source_bytes IS NULL)
        AND (object_key IS NULL) = (stripped_bytes IS NULL)
        AND (object_key IS NULL) = (stored_bytes IS NULL)
        AND (object_key IS NULL) = (made_at IS NULL)
    ),
    CONSTRAINT map_viewer_files_failed_together CHECK ((failed_at IS NULL) = (failed_reason IS NULL))
);
