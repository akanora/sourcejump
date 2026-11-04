//! `GET /v1/servers/activity`: players and servers online over time, across listed servers, for the chart on
//! the Servers page. Up to a month is built from `server_heartbeat_log`, which keeps 30 days; a year from
//! `server_activity_daily`.

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use sqlx::PgPool;

use crate::{app::AppState, error::ApiError};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ActivityRange {
    Day,
    Week,
    Month,
    Year,
}

impl ActivityRange {
    /// Bucket length in minutes, and how many buckets. Two heartbeats per server per bucket at least, so a
    /// missed one doesn't read as a server going offline. A year is one point per UTC day.
    fn buckets(self) -> (i32, i32) {
        match self {
            Self::Day => (20, 72),
            Self::Week => (120, 84),
            Self::Month => (480, 90),
            Self::Year => (1440, 365),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ActivityQuery {
    /// `day` (the default), `week`, `month` or `year`.
    range: Option<ActivityRange>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ServerActivity {
    pub range: ActivityRange,
    pub bucket_minutes: i32,
    /// Oldest first, one per bucket, empty buckets included. The bucket still in progress is left out, so the
    /// last point isn't a partial count.
    pub points: Vec<ActivityPoint>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ActivityPoint {
    /// Where the bucket starts.
    pub at: DateTime<Utc>,
    /// Listed servers heard from during the bucket.
    pub servers: i32,
    /// The average player count of each of those servers during the bucket, summed.
    pub players: i32,
}

/// Players and servers online over the last day, week, month or year.
#[utoipa::path(
    get,
    path = "/v1/servers/activity",
    tag = "servers",
    params(ActivityQuery),
    responses((status = OK, body = ServerActivity)),
)]
pub async fn server_activity(
    State(state): State<AppState>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<ServerActivity>, ApiError> {
    let range = query.range.unwrap_or(ActivityRange::Day);
    let (bucket_minutes, count) = range.buckets();
    let points = if let ActivityRange::Year = range {
        by_day(&state.db, count).await?
    } else {
        by_bucket(&state.db, bucket_minutes, count).await?
    };
    Ok(Json(ServerActivity {
        range,
        bucket_minutes,
        points,
    }))
}

/// Buckets of `minutes` from the heartbeat log.
async fn by_bucket(
    db: &PgPool,
    minutes: i32,
    count: i32,
) -> Result<Vec<ActivityPoint>, sqlx::Error> {
    sqlx::query_as!(
        ActivityPoint,
        r#"
        WITH bounds AS (
            SELECT make_interval(mins => $1) AS bucket,
                   date_bin(make_interval(mins => $1), now(), TIMESTAMPTZ '2000-01-01') AS current
        ), buckets AS (
            SELECT generate_series(current - $2 * bucket, current - bucket, bucket) AS at FROM bounds
        ), per_server AS (
            SELECT date_bin(bounds.bucket, h.received_at, TIMESTAMPTZ '2000-01-01') AS at,
                   h.ip, h.port, avg(h.players) AS players
            FROM server_heartbeat_log h
            CROSS JOIN bounds
            JOIN server_listings l ON l.ip = h.ip AND l.port = h.port
            WHERE h.received_at >= bounds.current - $2 * bounds.bucket AND h.received_at < bounds.current
            GROUP BY 1, 2, 3
        )
        SELECT b.at AS "at!", count(p.ip)::int AS "servers!", coalesce(round(sum(p.players)), 0)::int AS "players!"
        FROM buckets b
        LEFT JOIN per_server p ON p.at = b.at
        GROUP BY b.at
        ORDER BY b.at
        "#,
        minutes,
        f64::from(count)
    )
    .fetch_all(db)
    .await
}

/// The last `count` whole UTC days from the daily totals; today is still in progress, so it's left out.
async fn by_day(db: &PgPool, count: i32) -> Result<Vec<ActivityPoint>, sqlx::Error> {
    sqlx::query_as!(
        ActivityPoint,
        r#"
        WITH days AS (
            SELECT generate_series((today - $1::int)::timestamp, (today - 1)::timestamp, interval '1 day')::date AS day
            FROM (SELECT (now() AT TIME ZONE 'UTC')::date AS today) t
        )
        SELECT days.day::timestamp AT TIME ZONE 'UTC' AS "at!",
               count(d.ip)::int AS "servers!",
               coalesce(round(sum(d.players_sum::float8 / d.heartbeats)), 0)::int AS "players!"
        FROM days
        LEFT JOIN server_activity_daily d ON d.day = days.day
            AND EXISTS (SELECT 1 FROM server_listings l WHERE l.ip = d.ip AND l.port = d.port)
        GROUP BY days.day
        ORDER BY days.day
        "#,
        count
    )
    .fetch_all(db)
    .await
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use super::ServerActivity;
    use crate::{
        servers::{
            heartbeat::tests::{beat, report},
            listing,
        },
        test_client,
    };

    #[sqlx::test]
    async fn counts_listed_servers_and_their_players_per_bucket(db: PgPool) {
        listing::list(&db, "203.0.113.1:27015".parse().unwrap(), None)
            .await
            .unwrap();
        listing::list(&db, "203.0.113.2:27015".parse().unwrap(), None)
            .await
            .unwrap();
        for ip in ["203.0.113.1", "203.0.113.2", "203.0.113.3"] {
            beat(&db, ip, None, &report(27015)).await;
        }
        // Only listed servers are logged; move their beats an hour back so they fall in a finished bucket.
        let mut more = report(27015);
        more["players"] = serde_json::json!(20);
        beat(&db, "203.0.113.1", None, &more).await;
        sqlx::query("UPDATE server_heartbeat_log SET received_at = date_bin('20 minutes', now(), '2000-01-01') - interval '50 minutes'")
            .execute(&db)
            .await
            .unwrap();

        let activity: ServerActivity = test_client::get(&db, "/v1/servers/activity").await.json();

        assert_eq!(activity.bucket_minutes, 20);
        assert_eq!(activity.points.len(), 72);
        let busy: Vec<_> = activity
            .points
            .iter()
            .filter(|p| p.servers > 0)
            .map(|p| (p.servers, p.players))
            .collect();
        // .1 averaged (12 + 20) / 2 = 16, .2 had 12; .3 isn't listed.
        assert_eq!(busy, [(2, 28)]);
    }

    #[sqlx::test]
    async fn a_year_is_daily_averages(db: PgPool) {
        listing::list(&db, "203.0.113.1:27015".parse().unwrap(), None)
            .await
            .unwrap();
        let mut quiet = report(27015);
        quiet["players"] = serde_json::json!(4);
        beat(&db, "203.0.113.1", None, &report(27015)).await;
        beat(&db, "203.0.113.1", None, &quiet).await;
        beat(&db, "203.0.113.2", None, &report(27015)).await;
        // Today is left out of the year, so move today's totals to yesterday.
        sqlx::query("UPDATE server_activity_daily SET day = day - 1")
            .execute(&db)
            .await
            .unwrap();

        let year: ServerActivity = test_client::get(&db, "/v1/servers/activity?range=year")
            .await
            .json();

        assert_eq!((year.bucket_minutes, year.points.len()), (1440, 365));
        let last = year.points.last().unwrap();
        // (12 + 4) / 2 players on average, on the one listed server.
        assert_eq!((last.servers, last.players), (1, 8));
    }

    #[sqlx::test]
    async fn knows_its_ranges(db: PgPool) {
        let week: ServerActivity = test_client::get(&db, "/v1/servers/activity?range=week")
            .await
            .json();
        assert_eq!((week.bucket_minutes, week.points.len()), (120, 84));
        assert!(week.points.iter().all(|p| p.servers == 0 && p.players == 0));
        let status = test_client::get(&db, "/v1/servers/activity?range=decade")
            .await
            .status;
        assert_eq!(status, 400);
    }
}
