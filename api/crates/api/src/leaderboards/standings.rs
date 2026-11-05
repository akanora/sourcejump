//! Stored points and totals: `personal_bests.points`, `standings` and `legacy_standings`, recounted where
//! they change so the leaderboards only read them.
//!
//! What changes them, and who calls what here:
//! - a personal best set or removed (the ingest, run invalidation): `refresh_runs`, for those runs' tracks.
//!   A new world record moves the speed points of everyone on its board, so a whole track is recounted;
//! - a track's tier (`staff/maps.rs`): `refresh_track`;
//! - the points or tiers policy (`staff/policies.rs`), or a new draft or formula in code: `refresh_all`, at
//!   publishing or at startup (`refresh_if_stale`);
//! - a ban or lifted ban, or a legacy import: `refresh_legacy`, as banned players' legacy runs don't count.
//!
//! Every recount takes one advisory lock and recounts from what's committed, so two at once can't leave
//! totals that miss each other's personal bests. Recounts are small (a track's boards, the players on them),
//! and the lock is held to the end of the caller's transaction.

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

/// After personal bests changed on these runs' tracks: recounts those tracks, in every style.
pub async fn refresh_runs(conn: &mut PgConnection, run_ids: &[i64]) -> Result<(), sqlx::Error> {
    refresh(conn, run_ids, &[], &[]).await
}

/// After a track's tier changed: recounts it, in every style.
pub async fn refresh_track(
    conn: &mut PgConnection,
    map_id: i64,
    track: i16,
) -> Result<(), sqlx::Error> {
    refresh(conn, &[], &[map_id], &[track]).await
}

/// Recounts the tracks of `run_ids` and those of `map_ids` × `tracks` (pairs, by position): their personal
/// bests' points, then the totals of every player on them, and of the runs' players, who may have just lost
/// their personal best there.
async fn refresh(
    conn: &mut PgConnection,
    run_ids: &[i64],
    map_ids: &[i64],
    tracks: &[i16],
) -> Result<(), sqlx::Error> {
    lock(conn).await?;
    let formula = formula(conn).await?;
    let p = formula.policy;
    sqlx::query!(
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
    .execute(&mut *conn)
    .await?;

    // Delete-then-insert under the lock: a player who no longer has a personal best there loses their row.
    sqlx::query!(
        r#"
        WITH tracks AS (
            SELECT map_id, track FROM runs WHERE id = ANY($1)
            UNION SELECT * FROM unnest($2::int8[], $3::int2[])
        ), affected AS (
            SELECT style, track > 0 AS bonus, player_steamid64 FROM personal_bests
            WHERE (map_id, track) IN (SELECT map_id, track FROM tracks)
            UNION SELECT style, track > 0, player_steamid64 FROM runs WHERE id = ANY($1)
        )
        DELETE FROM standings s USING affected a
        WHERE s.style = a.style AND s.bonus = a.bonus AND s.player_steamid64 = a.player_steamid64
        "#,
        run_ids,
        map_ids,
        tracks
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        r#"
        WITH tracks AS (
            SELECT map_id, track FROM runs WHERE id = ANY($1)
            UNION SELECT * FROM unnest($2::int8[], $3::int2[])
        ), affected AS (
            SELECT style, track > 0 AS bonus, player_steamid64 FROM personal_bests
            WHERE (map_id, track) IN (SELECT map_id, track FROM tracks)
            UNION SELECT style, track > 0, player_steamid64 FROM runs WHERE id = ANY($1)
        )
        INSERT INTO standings (style, bonus, player_steamid64, points, completed)
        SELECT pb.style, pb.track > 0, pb.player_steamid64, sum(pb.points), count(*)
        FROM personal_bests pb
        JOIN affected a ON a.style = pb.style AND a.bonus = (pb.track > 0)
                       AND a.player_steamid64 = pb.player_steamid64
        GROUP BY pb.style, pb.track > 0, pb.player_steamid64
        "#,
        run_ids,
        map_ids,
        tracks
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Recounts everything, 2.0 and legacy, with the formula in force, and records that formula.
pub async fn refresh_all(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
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
            WHERE NOT EXISTS (
                SELECT 1 FROM bans
                WHERE bans.player_steamid64 = l.player_steamid64 AND bans.restrictions & $6 <> 0
                  AND bans.lifted_at IS NULL AND (bans.ends_at IS NULL OR bans.ends_at > now())
            )
        ) scored
        GROUP BY player_steamid64
        "#,
        f64::from(p.base),
        f64::from(p.growth_percent),
        f64::from(p.finish_percent),
        f64::from(p.speed_exponent),
        f64::from(p.bonus_percent),
        Restriction::NoRecords.bit()
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
