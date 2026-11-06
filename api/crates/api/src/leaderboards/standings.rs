//! Stored points and totals: `personal_bests.points`, `standings`, `legacy_standings` and `maps.players`,
//! recounted where they change so the leaderboards and the map list only read them.
//!
//! What changes them, and who calls what here:
//! - a personal best set or removed (the ingest, run invalidation): `refresh_runs`, for those runs' tracks.
//!   A new world record moves the speed points of everyone on its board, so a whole track's points are
//!   recounted, and the totals of the players whose points changed; and those maps' player counts;
//! - a track's tier (`staff/maps.rs`): `refresh_track`;
//! - the points or tiers policy (`staff/policies.rs`), or a new draft or formula in code: `refresh_all`, at
//!   publishing or at startup (`refresh_if_stale`);
//! - a ban or lifted ban, or a legacy import: `refresh_legacy`, as banned players' legacy runs don't count.
//!   A timed ban ends on its date with nothing written, so `watch_ended_bans` looks for those.
//!
//! Every recount takes one advisory lock and recounts from what's committed, so two at once can't leave
//! totals that miss each other's personal bests. Recounts are small (a track's boards, the players on them),
//! and the lock is held to the end of the caller's transaction.
//!
//! Lock order, the same everywhere so nothing deadlocks: a map's row, then personal bests, then this lock.
//! The ingest and invalidation lock the map and write personal bests before they recount, so a tier change
//! locks its map first and a full recount locks the whole `personal_bests` table first.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool, types::Json as JsonColumn};
use utoipa::ToSchema;

use crate::{
    maps::tiers,
    players::restrictions::Restriction,
    policies::{PointsPolicy, Policy},
};

/// The advisory lock every recount holds: "standings" in ASCII.
const LOCK: i64 = 0x7374_616e_6469_6e67;
/// How often `watch_ended_bans` looks. Looking costs a few index reads per records ban ever given.
const ENDED_BANS_INTERVAL: Duration = Duration::from_mins(5);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PointsFormula {
    #[serde(flatten)]
    pub policy: PointsPolicy,
    /// True while the community hasn't published a formula and the draft is used.
    pub draft: bool,
    /// False until a tier count is published; 2.0 tracks without a tier earn no points.
    pub tiers: bool,
}

/// The published points policy, or the draft while there's none.
pub async fn formula(conn: &mut PgConnection) -> Result<PointsFormula, sqlx::Error> {
    let published = sqlx::query_scalar!(
        "SELECT value FROM policies WHERE name = 'points' ORDER BY version DESC LIMIT 1"
    )
    .fetch_optional(&mut *conn)
    .await?;
    let published = published.and_then(|value| match Policy::from_row("points", &value) {
        Some(Policy::Points(policy)) => Some(policy),
        _ => None,
    });
    Ok(PointsFormula {
        policy: published.unwrap_or(PointsPolicy::DRAFT),
        draft: published.is_none(),
        tiers: tiers::tier_count(conn).await?.is_some(),
    })
}

/// After personal bests changed on these runs' tracks: recounts their maps' player counts, then those tracks,
/// in every style.
///
/// The player counts are recounted only here: a tier or policy change moves points, not who has a personal
/// best, and `refresh_all` locks every personal best before any map row, so recounting maps there would break
/// the lock order. They're recounted before this module's lock is taken: the callers' map row locks are what
/// keep them right, and every ingest waits on this lock.
pub async fn refresh_runs(conn: &mut PgConnection, run_ids: &[i64]) -> Result<(), sqlx::Error> {
    crate::maps::count_players(conn, run_ids).await?;
    refresh(conn, run_ids, &[], &[]).await
}

/// After a track's tier changed: recounts it, in every style.
pub async fn refresh_track(
    conn: &mut PgConnection,
    map_id: i64,
    track: i16,
) -> Result<(), sqlx::Error> {
    sqlx::query!("SELECT id FROM maps WHERE id = $1 FOR UPDATE", map_id)
        .fetch_optional(&mut *conn)
        .await?;
    refresh(conn, &[], &[map_id], &[track]).await
}

/// Recounts the tracks of `run_ids` and those of `map_ids` × `tracks` (pairs, by position): their personal
/// bests' points, then the totals of the players whose points there changed, and of the runs' players, who
/// may have a new personal best there or have just lost one.
///
/// Only those totals: a player's total changes only with their own points, so a personal best that leaves
/// the world record as it was recounts one player, not everyone on the board (external audit, 2026-11-06).
async fn refresh(
    conn: &mut PgConnection,
    run_ids: &[i64],
    map_ids: &[i64],
    tracks: &[i16],
) -> Result<(), sqlx::Error> {
    lock(conn).await?;
    let formula = formula(conn).await?;
    let p = formula.policy;
    let changed = sqlx::query!(
        r#"
        WITH tracks AS (
            SELECT map_id, track FROM runs WHERE id = ANY($1)
            UNION SELECT * FROM unnest($2::int8[], $3::int2[])
        ), tiers AS (
            SELECT DISTINCT ON (map_id, track) map_id, track, tier FROM map_tiers
            WHERE $4 AND (map_id, track) IN (SELECT map_id, track FROM tracks)
            ORDER BY map_id, track, assigned_at DESC
        ), scored AS (
            SELECT pb.player_steamid64, pb.map_id, pb.style, pb.track,
                   coalesce(points_for(t.tier, pb.time,
                                       min(pb.time) OVER (PARTITION BY pb.map_id, pb.style, pb.track),
                                       pb.track > 0, $5, $6, $7, $8, $9), 0) AS points
            FROM personal_bests pb
            LEFT JOIN tiers t ON t.map_id = pb.map_id AND t.track = pb.track
            WHERE (pb.map_id, pb.track) IN (SELECT map_id, track FROM tracks)
        )
        UPDATE personal_bests pb SET points = scored.points FROM scored
        WHERE pb.player_steamid64 = scored.player_steamid64 AND pb.map_id = scored.map_id
          AND pb.style = scored.style AND pb.track = scored.track AND pb.points <> scored.points
        RETURNING pb.style, pb.track > 0 AS "bonus!", pb.player_steamid64
        "#,
        run_ids,
        map_ids,
        tracks,
        formula.tiers,
        f64::from(p.base),
        f64::from(p.growth_percent),
        f64::from(p.finish_percent),
        f64::from(p.speed_exponent),
        f64::from(p.bonus_percent)
    )
    .fetch_all(&mut *conn)
    .await?;
    let styles: Vec<String> = changed.iter().map(|row| row.style.clone()).collect();
    let bonuses: Vec<bool> = changed.iter().map(|row| row.bonus).collect();
    let players: Vec<i64> = changed.iter().map(|row| row.player_steamid64).collect();

    // Delete-then-insert under the lock: a player who no longer has a personal best there loses their row.
    sqlx::query!(
        r#"
        WITH affected AS (
            SELECT * FROM unnest($2::text[], $3::bool[], $4::int8[]) AS a (style, bonus, player_steamid64)
            UNION SELECT style, track > 0, player_steamid64 FROM runs WHERE id = ANY($1)
        )
        DELETE FROM standings s USING affected a
        WHERE s.style = a.style AND s.bonus = a.bonus AND s.player_steamid64 = a.player_steamid64
        "#,
        run_ids,
        &styles,
        &bonuses,
        &players
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        r#"
        WITH affected AS (
            SELECT * FROM unnest($2::text[], $3::bool[], $4::int8[]) AS a (style, bonus, player_steamid64)
            UNION SELECT style, track > 0, player_steamid64 FROM runs WHERE id = ANY($1)
        )
        INSERT INTO standings (style, bonus, player_steamid64, points, completed)
        SELECT a.style, a.bonus, a.player_steamid64, totals.points, totals.completed
        FROM affected a
        -- Each player's own personal bests, through the primary key: joined on the list instead, the planner
        -- can't tell how short it is and reads every personal best.
        CROSS JOIN LATERAL (
            SELECT sum(pb.points) AS points, count(*) AS completed FROM personal_bests pb
            WHERE pb.player_steamid64 = a.player_steamid64 AND pb.style = a.style AND (pb.track > 0) = a.bonus
        ) totals
        WHERE totals.completed > 0
        "#,
        run_ids,
        &styles,
        &bonuses,
        &players
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Recounts everything, 2.0 and legacy, with the formula in force, and records that formula.
pub async fn refresh_all(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    // Waits for runs being stored to commit and holds new ones back; reads go on.
    crate::query_time_limit::lift(conn).await?;
    sqlx::query!("LOCK TABLE personal_bests IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut *conn)
        .await?;
    lock(conn).await?;
    let formula = formula(conn).await?;
    let p = formula.policy;
    sqlx::query!(
        r#"
        WITH tiers AS (
            SELECT DISTINCT ON (map_id, track) map_id, track, tier FROM map_tiers
            WHERE $1 ORDER BY map_id, track, assigned_at DESC
        ), scored AS (
            SELECT pb.player_steamid64, pb.map_id, pb.style, pb.track,
                   coalesce(points_for(t.tier, pb.time,
                                       min(pb.time) OVER (PARTITION BY pb.map_id, pb.style, pb.track),
                                       pb.track > 0, $2, $3, $4, $5, $6), 0) AS points
            FROM personal_bests pb
            LEFT JOIN tiers t ON t.map_id = pb.map_id AND t.track = pb.track
        )
        UPDATE personal_bests pb SET points = scored.points FROM scored
        WHERE pb.player_steamid64 = scored.player_steamid64 AND pb.map_id = scored.map_id
          AND pb.style = scored.style AND pb.track = scored.track AND pb.points <> scored.points
        "#,
        formula.tiers,
        f64::from(p.base),
        f64::from(p.growth_percent),
        f64::from(p.finish_percent),
        f64::from(p.speed_exponent),
        f64::from(p.bonus_percent)
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!("DELETE FROM standings")
        .execute(&mut *conn)
        .await?;
    sqlx::query!(
        r#"
        INSERT INTO standings (style, bonus, player_steamid64, points, completed)
        SELECT style, track > 0, player_steamid64, sum(points), count(*)
        FROM personal_bests GROUP BY style, track > 0, player_steamid64
        "#
    )
    .execute(&mut *conn)
    .await?;
    count_legacy(conn, &formula).await?;
    sqlx::query!(
        r#"
        INSERT INTO standings_formula (formula) VALUES ($1)
        ON CONFLICT (singleton) DO UPDATE SET formula = excluded.formula
        "#,
        JsonColumn(&formula) as _
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// After a ban, a lifted ban or a legacy import: recounts the legacy standings.
pub async fn refresh_legacy(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    lock(conn).await?;
    let formula = formula(conn).await?;
    count_legacy(conn, &formula).await
}

/// Runs for as long as the API does, starting with a look at startup, which also finds bans that ended while
/// it was down.
pub async fn watch_ended_bans(db: PgPool) {
    let mut ticks = tokio::time::interval(ENDED_BANS_INTERVAL);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        match refresh_legacy_if_bans_ended(&db).await {
            Ok(true) => tracing::info!("recounted legacy standings after a records ban ended"),
            Ok(false) => {}
            Err(error) => {
                tracing::error!(%error, "looking for ended bans failed; trying again later");
            }
        }
    }
}

/// Recounts the legacy standings if they're missing a player with legacy runs whose records ban is over: one
/// that ended on its date since they were counted. Lifting a ban recounts by itself, so this finds only those.
pub async fn refresh_legacy_if_bans_ended(db: &PgPool) -> Result<bool, sqlx::Error> {
    // Looked for outside the lock, which ingest waits on; the recount reads what's committed under it.
    let stale = sqlx::query_scalar!(
        r#"SELECT EXISTS (
               SELECT 1 FROM bans b
               WHERE b.restrictions & $1 <> 0
                 AND NOT EXISTS (SELECT 1 FROM records_bans r WHERE r.player_steamid64 = b.player_steamid64)
                 AND NOT EXISTS (SELECT 1 FROM legacy_standings s WHERE s.player_steamid64 = b.player_steamid64)
                 AND EXISTS (SELECT 1 FROM legacy_runs l WHERE l.player_steamid64 = b.player_steamid64)
           ) AS "stale!""#,
        Restriction::NoRecords.bit()
    )
    .fetch_one(db)
    .await?;
    if stale {
        let mut tx = db.begin().await?;
        refresh_legacy(&mut tx).await?;
        tx.commit().await?;
    }
    Ok(stale)
}

/// At startup: recounts everything if the formula in force isn't the one the stored points were counted with,
/// as after this table's migration or a new draft in code.
pub async fn refresh_if_stale(db: &PgPool) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let counted = sqlx::query_scalar!("SELECT formula FROM standings_formula")
        .fetch_optional(&mut *tx)
        .await?;
    let in_force = formula(&mut tx).await?;
    let current = counted
        .and_then(|counted| serde_json::from_value::<PointsFormula>(counted).ok())
        .is_some_and(|counted| counted == in_force);
    if current {
        return Ok(false);
    }
    refresh_all(&mut tx).await?;
    tx.commit().await?;
    Ok(true)
}

/// Legacy records are one style's main tracks, on the old site's tiers, which are always in force for them.
async fn count_legacy(conn: &mut PgConnection, formula: &PointsFormula) -> Result<(), sqlx::Error> {
    let p = formula.policy;
    sqlx::query!("DELETE FROM legacy_standings")
        .execute(&mut *conn)
        .await?;
    sqlx::query!(
        r#"
        INSERT INTO legacy_standings (player_steamid64, points, completed)
        SELECT player_steamid64, sum(points), count(*) FROM (
            SELECT l.player_steamid64,
                   coalesce(points_for(m.tier, l.time, min(l.time) OVER (PARTITION BY l.map_id), false,
                                       $1, $2, $3, $4, $5), 0) AS points
            FROM legacy_personal_bests l
            JOIN legacy_maps m ON m.id = l.map_id
            WHERE NOT EXISTS (SELECT 1 FROM records_bans b WHERE b.player_steamid64 = l.player_steamid64)
        ) scored
        GROUP BY player_steamid64
        "#,
        f64::from(p.base),
        f64::from(p.growth_percent),
        f64::from(p.finish_percent),
        f64::from(p.speed_exponent),
        f64::from(p.bonus_percent)
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn lock(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    // A full recount takes seconds on real data, and waiting for another recount takes as long as that one.
    crate::query_time_limit::lift(conn).await?;
    sqlx::query!("SELECT pg_advisory_xact_lock($1)", LOCK)
        .execute(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use sqlx::PgPool;

    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    /// The ingest writes a personal best, then recounts. A full recount started in between used to take the
    /// standings lock and wait for that personal best, while the ingest waited for the lock: a deadlock.
    #[sqlx::test]
    async fn a_full_recount_waits_for_a_run_being_stored(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        let run_id: i64 = sqlx::query_scalar("SELECT run_id FROM personal_bests")
            .fetch_one(&db)
            .await
            .unwrap();

        // Points the full recount has to correct, so it needs the row the ingest is about to lock.
        sqlx::query("UPDATE personal_bests SET points = 123")
            .execute(&db)
            .await
            .unwrap();
        // As the ingest does: the personal best's row first, the recount after.
        let mut ingest = db.begin().await.unwrap();
        sqlx::query("UPDATE personal_bests SET time = 29.0")
            .execute(&mut *ingest)
            .await
            .unwrap();
        let full = tokio::spawn({
            let db = db.clone();
            async move {
                let mut tx = db.begin().await?;
                super::refresh_all(&mut tx).await?;
                tx.commit().await
            }
        });
        tokio::time::sleep(Duration::from_millis(300)).await;
        super::refresh_runs(&mut ingest, &[run_id]).await.unwrap();
        ingest.commit().await.unwrap();
        full.await.unwrap().unwrap();
    }
}
