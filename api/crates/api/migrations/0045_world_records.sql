-- World records stored instead of worked out on every read. Profiles and points pages counted a player's
-- records by checking each of their personal bests against its board, and Activity's records-only list
-- compared every recent run with its board's history (backend audit 2026-11-05). Both are kept current by
-- `leaderboards/world_records.rs` wherever runs or personal bests change; `world-records rebuild` recounts them.

-- Who holds each board's record now: every personal best with the board's fastest time, so a tie counts for
-- everyone in it. Leaving the personal best removes the row.
CREATE TABLE world_record_holders (
    player_steamid64 bigint NOT NULL,
    map_id bigint NOT NULL,
    style text NOT NULL,
    track smallint NOT NULL,
    PRIMARY KEY (map_id, style, track, player_steamid64),
    FOREIGN KEY (player_steamid64, map_id, style, track)
        REFERENCES personal_bests (player_steamid64, map_id, style, track) ON DELETE CASCADE
);

CREATE INDEX world_record_holders_player ON world_record_holders (player_steamid64, style, track);

INSERT INTO world_record_holders (player_steamid64, map_id, style, track)
SELECT pb.player_steamid64, pb.map_id, pb.style, pb.track
FROM personal_bests pb
WHERE NOT EXISTS (
    SELECT 1 FROM personal_bests faster
    WHERE faster.map_id = pb.map_id AND faster.style = pb.style AND faster.track = pb.track
      AND faster.time < pb.time
);

-- Whether a valid run beat every earlier valid run on its board when it was set, "earlier" in WR history's
-- order: finish time, then ID. Always false for an invalid run.
ALTER TABLE runs ADD COLUMN was_record boolean NOT NULL DEFAULT false;

UPDATE runs r SET was_record = true
FROM (
    SELECT id, time < coalesce(min(time) OVER (
               PARTITION BY map_id, style, track ORDER BY finished_at, id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 'infinity') AS was_record
    FROM runs WHERE invalidated_at IS NULL
) earlier
WHERE earlier.id = r.id AND earlier.was_record;

CREATE INDEX runs_records ON runs (finished_at DESC, id DESC) WHERE invalidated_at IS NULL AND was_record;
