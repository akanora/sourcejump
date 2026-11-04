-- Each player's fastest legacy run per map, which the pre-2.0 views of boards and profiles show. A view
-- rather than a table: legacy runs only change when an import replaces them all. Queries leave out players
-- banned from records themselves, since bans change and a view can't take the restriction bit.
CREATE VIEW legacy_personal_bests AS
SELECT DISTINCT ON (map_id, player_steamid64) *
FROM legacy_runs
-- An undated run sorts last among equal times, after the ones whose order is known.
ORDER BY map_id, player_steamid64, time, finished_at NULLS LAST, id;

CREATE INDEX legacy_runs_personal_best ON legacy_runs (map_id, player_steamid64, time);
CREATE INDEX legacy_runs_player_personal_best ON legacy_runs (player_steamid64, map_id, time);
DROP INDEX legacy_runs_board;
DROP INDEX legacy_runs_player;
