-- Staff read one player's detections newest first, a page at a time by ID, so the player index carries the ID
-- and a page is one index range.
DROP INDEX anticheat_detections_player;
CREATE INDEX anticheat_detections_player ON anticheat_detections (player_steamid64, id);
