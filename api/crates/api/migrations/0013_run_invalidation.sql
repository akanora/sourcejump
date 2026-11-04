-- Run invalidation: staff take a run off the boards, or every run of a player or key at once, and can restore
-- them. An invalidated run stays stored and opens by its ID; leaderboards, WR history, profiles and records
-- read only valid runs, and `personal_bests` holds only valid runs.
ALTER TABLE runs
    ADD COLUMN invalidated_at timestamptz,
    -- The staff log entry that invalidated it, so restoring that action brings back exactly the runs it took
    -- and none that were invalidated separately.
    ADD COLUMN invalidated_by bigint REFERENCES staff_log (id),
    ADD CONSTRAINT runs_invalidation_complete CHECK ((invalidated_at IS NULL) = (invalidated_by IS NULL));

CREATE INDEX runs_invalidated_by ON runs (invalidated_by) WHERE invalidated_by IS NOT NULL;
