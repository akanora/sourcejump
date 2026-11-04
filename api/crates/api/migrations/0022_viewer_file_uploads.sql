-- Viewer files are now packed by staff in their browser and uploaded (`staff/map_viewer_file.rs`), not fetched
-- from a mirror by a job, so there are no failed attempts to remember, and the map as it was before packing
-- never reaches SourceJump. A row is a stored file.

DELETE FROM map_viewer_files WHERE object_key IS NULL;

ALTER TABLE map_viewer_files
    DROP CONSTRAINT map_viewer_files_made_together,
    DROP CONSTRAINT map_viewer_files_failed_together,
    DROP COLUMN failed_at,
    DROP COLUMN failed_reason,
    DROP COLUMN source_bytes,
    ALTER COLUMN object_key SET NOT NULL,
    ALTER COLUMN stripped_bytes SET NOT NULL,
    ALTER COLUMN stored_bytes SET NOT NULL,
    ALTER COLUMN made_at SET NOT NULL;
