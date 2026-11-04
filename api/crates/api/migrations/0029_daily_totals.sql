-- Site-wide totals per UTC day, for the charts on the Players and Activity pages. Counting them on every view
-- would read every run; this is one row per day, kept by `daily_totals.rs`.
CREATE TABLE daily_totals (
    day date PRIMARY KEY,
    -- Players with at least one recorded time, 2.0 or pre-2.0, at the end of the day.
    players integer NOT NULL CHECK (players >= 0),
    -- Valid 2.0 runs that finished that day, by the game server's clock, and how many were world records.
    runs integer NOT NULL CHECK (runs >= 0),
    world_records integer NOT NULL CHECK (world_records >= 0 AND world_records <= runs)
);

-- Valid 2.0 runs per UTC day from `since` on, and how many were world records: faster than every valid run
-- that finished before it on its board, as WR history counts them. Each board's best before `since` is read
-- once, so refreshing the last two days doesn't scan a board for every run on it. A run dated in the future
-- by its server's clock counts today.
CREATE FUNCTION daily_run_totals(since timestamptz)
RETURNS TABLE (day date, runs integer, world_records integer)
LANGUAGE sql STABLE AS $$
    WITH recent AS (
        SELECT id, map_id, style, track, time, finished_at FROM runs
        WHERE invalidated_at IS NULL AND finished_at >= since
    ), earlier AS (
        SELECT b.map_id, b.style, b.track,
               (SELECT min(e.time) FROM runs e
                WHERE e.map_id = b.map_id AND e.style = b.style AND e.track = b.track
                  AND e.invalidated_at IS NULL AND e.finished_at < since) AS best
        FROM (SELECT DISTINCT map_id, style, track FROM recent) b
    ), placed AS (
        SELECT r.finished_at, r.time,
               -- LEAST skips NULLs: no earlier run, or no run before this one since `since`.
               LEAST(earlier.best, min(r.time) OVER (
                   PARTITION BY r.map_id, r.style, r.track ORDER BY r.finished_at, r.id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)) AS prior
        FROM recent r JOIN earlier USING (map_id, style, track)
    )
    SELECT (LEAST(finished_at, now()) AT TIME ZONE 'UTC')::date, count(*)::integer,
           (count(*) FILTER (WHERE prior IS NULL OR time < prior))::integer
    FROM placed
    GROUP BY 1
$$;
