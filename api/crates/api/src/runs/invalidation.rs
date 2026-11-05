//! Taking runs off the boards and putting them back, keeping `personal_bests` in step.
//!
//! Sensitive path. Callers are the logged staff functions in `staff/runs.rs`, which pass the transaction that
//! also writes the staff log entry, so a run's validity and the log never disagree, and the ingest, for runs
//! from banned players.

use sqlx::PgConnection;

use crate::{
    leaderboards::world_records,
    record_events::{self, Kind},
};

/// Marks these runs invalid, as done by the staff log entry `log_id`, and recomputes the personal bests and
/// world records they were on. Runs that are already invalid keep the entry that invalidated them first.
pub async fn invalidate(
    conn: &mut PgConnection,
    run_ids: &[i64],
    log_id: i64,
) -> Result<(), sqlx::Error> {
    world_records::lock_maps(conn, run_ids).await?;
    // Only runs that were on a board are reported: no server has a copy of the others.
    let off_the_boards = sqlx::query_scalar!(
        r#"
        WITH taken AS (
            UPDATE runs SET invalidated_at = now(), invalidated_by = $2
            WHERE id = ANY($1) AND invalidated_at IS NULL
            RETURNING id
        )
        SELECT t.id FROM taken t JOIN personal_bests pb ON pb.run_id = t.id
        "#,
        run_ids,
        log_id
    )
    .fetch_all(&mut *conn)
    .await?;
    recompute_personal_bests(conn, run_ids).await?;
    world_records::refresh(conn, run_ids).await?;
    record_events::record(conn, Kind::Invalidated, &off_the_boards).await
}

/// Marks a run that was just stored, and never on a board, invalid in the name of the staff log entry
/// `log_id`: for a banned player's runs, that of their ban.
pub async fn store_invalid(
    conn: &mut PgConnection,
    run_id: i64,
    log_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "UPDATE runs SET invalidated_at = now(), invalidated_by = $2 WHERE id = $1",
        run_id,
        log_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Makes these runs valid again and recomputes the personal bests and world records they compete for.
pub async fn restore(conn: &mut PgConnection, run_ids: &[i64]) -> Result<(), sqlx::Error> {
    world_records::lock_maps(conn, run_ids).await?;
    sqlx::query!(
        "UPDATE runs SET invalidated_at = NULL, invalidated_by = NULL WHERE id = ANY($1)",
        run_ids
    )
    .execute(&mut *conn)
    .await?;
    recompute_personal_bests(conn, run_ids).await?;
    world_records::refresh(conn, run_ids).await?;
    let back_on_the_boards = sqlx::query_scalar!(
        "SELECT run_id FROM personal_bests WHERE run_id = ANY($1)",
        run_ids
    )
    .fetch_all(&mut *conn)
    .await?;
    record_events::record(conn, Kind::Run, &back_on_the_boards).await
}

/// Sets the personal best of every board these runs are on (player, map, style, track) to the fastest valid
/// run there, or removes it when none is left, and recounts their points. Ties keep the earlier run, as the
/// ingest does.
///
/// Delete-then-insert rather than one statement: Postgres can't insert a key that the same statement deletes.
/// A run stored meanwhile is safe either way round: it either waits for this transaction and then compares
/// its time with the row written here, or committed first and is read by the insert's fresh snapshot. The
/// upsert covers another recompute of the same board committing in between.
async fn recompute_personal_bests(
    conn: &mut PgConnection,
    run_ids: &[i64],
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        DELETE FROM personal_bests pb
        USING (SELECT DISTINCT player_steamid64, map_id, style, track FROM runs WHERE id = ANY($1)) b
        WHERE pb.player_steamid64 = b.player_steamid64 AND pb.map_id = b.map_id
          AND pb.style = b.style AND pb.track = b.track
        "#,
        run_ids
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO personal_bests (player_steamid64, map_id, style, track, run_id, time, finished_at)
        SELECT DISTINCT ON (r.player_steamid64, r.map_id, r.style, r.track)
               r.player_steamid64, r.map_id, r.style, r.track, r.id, r.time, r.finished_at
        FROM runs r
        JOIN (SELECT DISTINCT player_steamid64, map_id, style, track FROM runs WHERE id = ANY($1)) b
          ON r.player_steamid64 = b.player_steamid64 AND r.map_id = b.map_id
         AND r.style = b.style AND r.track = b.track
        WHERE r.invalidated_at IS NULL
        ORDER BY r.player_steamid64, r.map_id, r.style, r.track, r.time, r.id
        ON CONFLICT (player_steamid64, map_id, style, track)
        DO UPDATE SET run_id = excluded.run_id, time = excluded.time, finished_at = excluded.finished_at
        "#,
        run_ids
    )
    .execute(&mut *conn)
    .await?;
    crate::leaderboards::standings::refresh_runs(conn, run_ids).await
}
