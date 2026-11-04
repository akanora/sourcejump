-- Leaderboards order equal times by when the run finished. Copying the finish time from the run, as `time`
-- already is, lets a board page read its entries in order from one index instead of joining every personal
-- best to `runs` and sorting the whole board. The index carries the player so a page needs no other lookup
-- before its final join.
ALTER TABLE personal_bests ADD COLUMN finished_at timestamptz;
UPDATE personal_bests pb SET finished_at = r.finished_at FROM runs r WHERE r.id = pb.run_id;
ALTER TABLE personal_bests ALTER COLUMN finished_at SET NOT NULL;

CREATE INDEX personal_bests_board ON personal_bests (map_id, style, track, time, finished_at, run_id)
    INCLUDE (player_steamid64);
DROP INDEX personal_bests_leaderboard;
