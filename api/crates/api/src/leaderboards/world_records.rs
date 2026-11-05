//! Stored world records: `world_record_holders` (who holds each board's record now) and `runs.was_record`
//! (whether a run was a record when it was set), kept current so profiles, the points leaderboards and
//! Activity read them instead of comparing every personal best or run with its board.
//!
//! Both change only when a board's runs or personal bests do, so the two places that change those call
//! `refresh` for the boards they touched: the ingest, for every valid run it stores, and run invalidation
//! and restoring. A run arriving late, with an earlier finish time, can take the record-when-set from runs
//! after it, so the whole board is redone, not just the new run.
//!
//! Concurrency: each refresh reads the board from what's committed, under the board's map row lock. The ingest
//! already holds it (`maps::record_run` updates the row); invalidation takes it with `lock_maps` before
//! anything else that the ingest locks after it, so the two can't deadlock.

use sqlx::{PgConnection, PgPool};

/// Takes the map row lock for every board these runs are on, in map ID order, so two invalidations can't
/// deadlock either. Called before the runs' personal bests are recomputed, which takes the standings lock.
pub async fn lock_maps(conn: &mut PgConnection, run_ids: &[i64]) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"SELECT id FROM maps WHERE id IN (SELECT map_id FROM runs WHERE id = ANY($1))
           ORDER BY id FOR UPDATE"#,
        run_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(())
}

/// Redoes the record holders and every run's record-when-set on the boards (map, style, track) these runs
/// are on. Only rows that change are written. Returns how many did.
pub async fn refresh(conn: &mut PgConnection, run_ids: &[i64]) -> Result<u64, sqlx::Error> {
    let removed = sqlx::query!(
        r#"
        WITH boards AS (SELECT DISTINCT map_id, style, track FROM runs WHERE id = ANY($1))
        DELETE FROM world_record_holders h USING boards b
        WHERE h.map_id = b.map_id AND h.style = b.style AND h.track = b.track
          AND EXISTS (
              SELECT 1 FROM personal_bests pb JOIN personal_bests faster
                ON faster.map_id = pb.map_id AND faster.style = pb.style AND faster.track = pb.track
               AND faster.time < pb.time
              WHERE pb.player_steamid64 = h.player_steamid64 AND pb.map_id = h.map_id
                AND pb.style = h.style AND pb.track = h.track
          )
        "#,
        run_ids
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    let added = sqlx::query!(
        r#"
        WITH boards AS (SELECT DISTINCT map_id, style, track FROM runs WHERE id = ANY($1))
        INSERT INTO world_record_holders (player_steamid64, map_id, style, track)
        SELECT pb.player_steamid64, pb.map_id, pb.style, pb.track
        FROM personal_bests pb
        JOIN boards b ON b.map_id = pb.map_id AND b.style = pb.style AND b.track = pb.track
        WHERE NOT EXISTS (
            SELECT 1 FROM personal_bests faster
            WHERE faster.map_id = pb.map_id AND faster.style = pb.style AND faster.track = pb.track
              AND faster.time < pb.time
        )
        ON CONFLICT DO NOTHING
        "#,
        run_ids
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    // The board's best before each run, over valid runs alone; an invalid run is never a record.
    let flagged = sqlx::query!(
        r#"
        WITH boards AS (SELECT DISTINCT map_id, style, track FROM runs WHERE id = ANY($1)),
        earlier AS (
            SELECT r.id,
                   r.invalidated_at IS NULL AND r.time < coalesce(
                       min(r.time) FILTER (WHERE r.invalidated_at IS NULL) OVER (
                           PARTITION BY r.map_id, r.style, r.track ORDER BY r.finished_at, r.id
                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
                       'infinity') AS was_record
            FROM runs r
            JOIN boards b ON b.map_id = r.map_id AND b.style = r.style AND b.track = r.track
        )
        UPDATE runs r SET was_record = earlier.was_record FROM earlier
        WHERE r.id = earlier.id AND r.was_record <> earlier.was_record
        "#,
        run_ids
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(removed + added + flagged)
}

/// Redoes every board, for `world-records rebuild` and the tests that check nothing drifted. Returns how many
/// rows changed: 0 when the stored records were already right.
pub async fn rebuild(db: &PgPool) -> Result<u64, sqlx::Error> {
    let mut tx = db.begin().await?;
    // One run per board names it.
    let run_ids =
        sqlx::query_scalar!(r#"SELECT min(id) AS "id!" FROM runs GROUP BY map_id, style, track"#)
            .fetch_all(&mut *tx)
            .await?;
    let changed = refresh(&mut tx, &run_ids).await?;
    tx.commit().await?;
    Ok(changed)
}

#[cfg(test)]
pub(crate) mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    /// Fails if the stored world records differ from a recount. Tests of everything that changes runs or
    /// personal bests call it.
    pub(crate) async fn assert_current(db: &PgPool) {
        assert_eq!(
            super::rebuild(db).await.unwrap(),
            0,
            "stored world records drifted"
        );
    }

    async fn holders(db: &PgPool) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT p.name FROM world_record_holders h
             JOIN players p ON p.steamid64 = h.player_steamid64 ORDER BY p.name",
        )
        .fetch_all(db)
        .await
        .unwrap()
    }

    async fn records_when_set(db: &PgPool) -> Vec<String> {
        sqlx::query_scalar("SELECT server_run_id FROM runs WHERE was_record ORDER BY server_run_id")
            .fetch_all(db)
            .await
            .unwrap()
    }

    #[sqlx::test]
    async fn follow_new_runs_ties_and_late_arrivals(db: PgPool) {
        let key = setup(&db).await;
        let now = chrono::Utc::now().timestamp();
        let send = async |id: &str, time: f64, steamid64: &str, name: &str, ago: i64| {
            let mut body = run(id, time);
            body["player"] = json!({ "steamid64": steamid64, "name": name });
            body["finished_at"] = json!(now - ago);
            let sent = test_client::post(&db, "/v1/runs", Some(&key), &body).await;
            assert_eq!(sent.status, 201, "{:?}", sent.body);
        };
        send("a1", 30.0, "76561197960287930", "gabe", 300).await;
        send("b1", 25.0, "76561197960287931", "ricochet", 200).await;
        assert_eq!(holders(&db).await, ["ricochet"]);
        assert_eq!(records_when_set(&db).await, ["a1", "b1"]);

        // A tie for first: both hold it, and the later run wasn't a record when it was set.
        send("a2", 25.0, "76561197960287930", "gabe", 100).await;
        assert_eq!(holders(&db).await, ["gabe", "ricochet"]);
        assert_eq!(records_when_set(&db).await, ["a1", "b1"]);

        // A queued run that finished before all of them: it was the record then, and the first run no
        // longer was. It doesn't change who holds the record now.
        send("c1", 28.0, "76561197960287940", "alice", 400).await;
        assert_eq!(records_when_set(&db).await, ["b1", "c1"]);
        assert_eq!(holders(&db).await, ["gabe", "ricochet"]);
        assert_current(&db).await;
    }
}
