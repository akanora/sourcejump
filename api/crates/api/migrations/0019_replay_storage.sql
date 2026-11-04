-- Replays are checked after upload and kept as SJR (`replays/sjr.rs`). The bucket is publicly readable, so
-- uploads and stored files carry a random part in their keys: only the API hands out where a file is.

ALTER TABLE replays RENAME COLUMN object_key TO upload_key;
-- Requests made before this migration pointed at the old place; nothing was deployed then.
UPDATE replays SET upload_key = 'uploads/' || upload_key;

ALTER TABLE replays
    ADD COLUMN stored_key text UNIQUE,
    ADD COLUMN stored_at timestamptz,
    -- The shavit file's size, and the SJR file's.
    ADD COLUMN raw_bytes integer CHECK (raw_bytes > 0),
    ADD COLUMN stored_bytes integer CHECK (stored_bytes > 0),
    -- The last upload that failed its checks, and why. A later good upload still counts.
    ADD COLUMN refused_at timestamptz,
    ADD COLUMN refused_reason text,
    ADD CONSTRAINT replays_stored_together CHECK (
        (stored_key IS NULL) = (stored_at IS NULL)
        AND (stored_key IS NULL) = (raw_bytes IS NULL)
        AND (stored_key IS NULL) = (stored_bytes IS NULL)
    ),
    ADD CONSTRAINT replays_refused_together CHECK ((refused_at IS NULL) = (refused_reason IS NULL));

-- Normal-style replays are public (poll 24–2, 2026-10-14); other styles stay private until decided.
INSERT INTO policies (name, version, value)
VALUES ('replays', 2, '{"request": "new_personal_best", "public_styles": ["normal"]}');
