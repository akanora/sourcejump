-- Each stored replay's route from above (`replays/route.rs`): up to 200 [x, y] points in Source units, which
-- the run page draws before the viewer is loaded. Replays stored before this have none; the page draws
-- without it.

ALTER TABLE replays ADD COLUMN route jsonb CHECK (stored_key IS NOT NULL OR route IS NULL);
