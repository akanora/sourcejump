//! What happened to records, `GET /v1/records/events`: new personal bests, their replays being stored, and runs
//! staff took off the boards, for game servers that announce records in chat or play them on their replay bot.
//!
//! Each event is written in the transaction of the change it reports, so it's never lost or seen early. Events
//! are paged by the writing transaction's ID, not the row ID alone: two runs stored at once can commit in
//! either order, and a reader paging by row ID would skip a lower ID that committed after a higher one. A
//! page only holds events from transactions older than every one still running, so nothing can appear behind
//! a cursor later. The cost is delay, never loss: a long transaction anywhere in the Postgres cluster holds
//! newer events back until it ends. Events are kept for a week. Servers that hold a connection open get the
//! same events pushed instead (`record_events/stream.rs`).

pub mod discord;
pub mod stream;

use std::{fmt, time::Duration};

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    replays::current_policy,
};

const PAGE_SIZE: i64 = 100;
const DEFAULT_MAX_RANK: i64 = 1;
const MAX_MAX_RANK: i64 = 100;
const PRUNE_INTERVAL: Duration = Duration::from_hours(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum Kind {
    /// A new personal best, or a restored run that is one again.
    Run,
    /// The run's replay is stored. `has_replay` says whether it can be downloaded.
    Replay,
    /// Staff took the run off the boards. A server that copied its replay should drop it and read the map's
    /// records again, since the next run moved up.
    Invalidated,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Run => "run",
            Self::Replay => "replay",
            Self::Invalidated => "invalidated",
        }
    }
}

/// Records events of one kind for these runs, on the caller's transaction. Open streams are woken when it
/// commits: Postgres holds a transaction's notifications until then.
///
/// Each event keeps the player's best time on the board from the valid runs SourceJump had before this one.
/// It's worked out here, not when read, because by then the personal best has moved on.
pub async fn record(
    conn: &mut PgConnection,
    kind: Kind,
    run_ids: &[i64],
) -> Result<(), sqlx::Error> {
    if run_ids.is_empty() {
        return Ok(());
    }
    sqlx::query!(
        r#"
        INSERT INTO record_events (kind, run_id, previous_time)
        SELECT $1, r.id,
               (SELECT min(o.time) FROM runs o
                WHERE o.player_steamid64 = r.player_steamid64 AND o.map_id = r.map_id AND o.style = r.style
                  AND o.track = r.track AND o.id < r.id AND o.invalidated_at IS NULL)
        FROM runs r
        WHERE r.id = ANY($2::bigint[])
        "#,
        kind as Kind as _,
        run_ids
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!("SELECT pg_notify('record_events', '')")
        .execute(conn)
        .await?;
    Ok(())
}

/// Deletes events older than a week, every hour, for as long as the API runs.
pub async fn run(db: PgPool) {
    let mut ticks = tokio::time::interval(PRUNE_INTERVAL);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticks.tick().await;
        if let Err(error) =
            sqlx::query!("DELETE FROM record_events WHERE created_at < now() - interval '7 days'")
                .execute(&db)
                .await
        {
            tracing::error!(%error, "pruning record events failed; trying again later");
        }
    }
}

/// A place in the event list: the writing transaction's ID, then the event's. Sent as `<tx>-<id>`; clients
/// treat it as opaque.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Cursor {
    tx: i64,
    id: i64,
}

impl fmt::Display for Cursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}-{}", self.tx, self.id)
    }
}

impl TryFrom<&str> for Cursor {
    type Error = ApiError;

    fn try_from(text: &str) -> Result<Self, ApiError> {
        let invalid = || {
            ApiError::Invalid(
                "not a cursor: send the `next` or event `id` SourceJump gave".to_owned(),
            )
        };
        let (tx, id) = text.split_once('-').ok_or_else(invalid)?;
        Ok(Self {
            tx: tx.parse().map_err(|_| invalid())?,
            id: id.parse().map_err(|_| invalid())?,
        })
    }
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct RecordEventsQuery {
    /// Continue after this point: the `next` of an earlier answer. Left out: no events, only a `next` that
    /// starts from now.
    after: Option<String>,
    /// Only runs that are now at this rank or better on their board, 1 to 100. Default 1, world records.
    /// `invalidated` events are always sent.
    max_rank: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RecordEvents {
    /// Oldest first, at most 100. A full page means more are waiting: ask again straight away.
    pub events: Vec<RecordEvent>,
    /// Send as `after` next time, whether or not there were events.
    pub next: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RecordEvent {
    /// This event's place in the list; usable as `after`.
    pub id: String,
    pub kind: Kind,
    pub run_id: i64,
    pub map: String,
    pub style: String,
    pub track: i16,
    /// SteamID64, as a string.
    pub steamid64: String,
    /// The player's latest name.
    pub name: String,
    /// Seconds.
    pub time: f64,
    /// The player's best time on this board before this run, when the event was written. None if they had
    /// none.
    pub previous_time: Option<f64>,
    pub tickrate: f32,
    /// The run's rank on its board now, not when it happened. None when it's no longer a personal best.
    pub rank: Option<i64>,
    /// Whether `GET /v1/replays/{run_id}` serves the replay now.
    pub has_replay: bool,
    pub at: DateTime<Utc>,
}

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(record_events))
        .routes(routes!(stream::record_stream))
}

/// Events about records since a cursor, for servers that poll every 10 to 30 seconds. No key needed: it's
/// what the site shows.
#[utoipa::path(
    get,
    path = "/v1/records/events",
    tag = "records",
    params(RecordEventsQuery),
    responses(
        (status = OK, body = RecordEvents),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid cursor or max_rank", body = ErrorBody),
    ),
)]
async fn record_events(
    State(state): State<AppState>,
    Query(query): Query<RecordEventsQuery>,
) -> Result<Json<RecordEvents>, ApiError> {
    let max_rank = check_max_rank(query.max_rank)?;
    let after = query.after.as_deref().map(Cursor::try_from).transpose()?;

    let mut conn = state.db.acquire().await?;
    let (events, next) = match after {
        Some(after) => page(&mut conn, after, max_rank).await?,
        None => (Vec::new(), caught_up(&mut conn).await?),
    };
    Ok(Json(RecordEvents {
        events,
        next: next.to_string(),
    }))
}

fn check_max_rank(max_rank: Option<i64>) -> Result<i64, ApiError> {
    let max_rank = max_rank.unwrap_or(DEFAULT_MAX_RANK);
    if (1..=MAX_MAX_RANK).contains(&max_rank) {
        Ok(max_rank)
    } else {
        Err(ApiError::Invalid(format!(
            "max_rank must be between 1 and {MAX_MAX_RANK}"
        )))
    }
}

/// Where unfinished transactions begin. Every transaction below this ID has finished, so its events are all
/// visible; later ones may not be yet.
async fn caught_up(conn: &mut PgConnection) -> Result<Cursor, sqlx::Error> {
    let oldest_running = sqlx::query_scalar!(
        r#"SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS "xmin!""#
    )
    .fetch_one(conn)
    .await?;
    Ok(Cursor {
        tx: oldest_running,
        id: 0,
    })
}

/// The events after `after`, at most a page, and where the next page starts.
async fn page(
    conn: &mut PgConnection,
    after: Cursor,
    max_rank: i64,
) -> Result<(Vec<RecordEvent>, Cursor), sqlx::Error> {
    let caught_up = caught_up(conn).await?;
    let rows = sqlx::query!(
        r#"
        SELECT e.tx, e.id, e.kind AS "kind: Kind", e.run_id, m.name AS map, r.style, r.track,
               r.player_steamid64::text AS "steamid64!", p.name, r.time, r.tickrate, e.created_at,
               e.previous_time, place.rank, rp.stored_key IS NOT NULL AS "stored!", r.invalidated_at IS NULL AS "valid!"
        FROM record_events e
        JOIN runs r ON r.id = e.run_id
        JOIN maps m ON m.id = r.map_id
        JOIN players p ON p.steamid64 = r.player_steamid64
        LEFT JOIN replays rp ON rp.run_id = e.run_id
        LEFT JOIN LATERAL (
            SELECT 1 + (SELECT count(*) FROM personal_bests o
                        WHERE o.map_id = pb.map_id AND o.style = pb.style AND o.track = pb.track
                          AND o.time < pb.time) AS rank
            FROM personal_bests pb WHERE pb.run_id = e.run_id
        ) place ON true
        WHERE (e.tx, e.id) > ($1, $2) AND e.tx < $3
          AND (e.kind = 'invalidated' OR place.rank <= $4)
        ORDER BY e.tx, e.id
        LIMIT $5
        "#,
        after.tx,
        after.id,
        caught_up.tx,
        max_rank,
        PAGE_SIZE
    )
    .fetch_all(&mut *conn)
    .await?;

    // A full page stops at its last event. Otherwise every finished transaction has been read, filtered out
    // or not, so the next ask starts where unfinished ones begin.
    let next = match rows.last() {
        Some(last) if i64::try_from(rows.len()) == Ok(PAGE_SIZE) => Cursor {
            tx: last.tx,
            id: last.id,
        },
        _ => after.max(caught_up),
    };
    if rows.is_empty() {
        // The usual answer, for every open stream on every wake: skip the policy read.
        return Ok((Vec::new(), next));
    }
    let policy = current_policy(conn).await?;
    let events = rows
        .into_iter()
        .map(|row| RecordEvent {
            id: Cursor {
                tx: row.tx,
                id: row.id,
            }
            .to_string(),
            has_replay: row.stored && row.valid && policy.is_public(&row.style),
            kind: row.kind,
            run_id: row.run_id,
            map: row.map,
            style: row.style,
            track: row.track,
            steamid64: row.steamid64,
            name: row.name,
            time: row.time,
            previous_time: row.previous_time,
            tickrate: row.tickrate,
            rank: row.rank,
            at: row.created_at,
        })
        .collect();
    Ok((events, next))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::{Kind, RecordEvents, record};
    use crate::{
        runs::{
            RunAccepted,
            tests::{run, setup},
        },
        staff::runs::{invalidate_run, restore_run},
        test_client,
    };

    /// The events after waiting for every transaction begun so far to finish. Transaction IDs are shared by
    /// the whole Postgres cluster, so other tests' databases hold events back for a moment.
    async fn events(db: &PgPool, query: &str) -> RecordEvents {
        let begun: i64 = sqlx::query_scalar("SELECT pg_current_xact_id()::text::bigint")
            .fetch_one(db)
            .await
            .unwrap();
        for _ in 0..500 {
            let oldest_running: i64 =
                sqlx::query_scalar("SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint")
                    .fetch_one(db)
                    .await
                    .unwrap();
            if oldest_running > begun {
                return events_as_they_are(db, query).await;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("transactions in other databases ran for over 10 s");
    }

    async fn events_as_they_are(db: &PgPool, query: &str) -> RecordEvents {
        let response = test_client::get(db, &format!("/v1/records/events?{query}")).await;
        assert_eq!(response.status, 200);
        response.json()
    }

    async fn now(db: &PgPool) -> String {
        events(db, "").await.next
    }

    async fn submit(db: &PgPool, key: &str, body: &serde_json::Value) -> i64 {
        let accepted: RunAccepted = test_client::post(db, "/v1/runs", Some(key), body)
            .await
            .json();
        accepted.id
    }

    fn by(player: &str, steamid64: &str, server_run_id: &str, time: f64) -> serde_json::Value {
        let mut body = run(server_run_id, time);
        body["player"] = json!({ "steamid64": steamid64, "name": player });
        body
    }

    #[sqlx::test]
    async fn a_new_client_starts_from_now_and_sees_what_follows_once(db: PgPool) {
        let key = setup(&db).await;
        submit(&db, &key, &run("before", 30.0)).await;

        let start = events(&db, "").await;
        let record = submit(&db, &key, &run("after", 29.0)).await;
        let first = events(&db, &format!("after={}", start.next)).await;
        let again = events(&db, &format!("after={}", first.next)).await;

        assert!(start.events.is_empty());
        let seen: Vec<_> = first
            .events
            .iter()
            .map(|e| (e.kind, e.run_id, e.rank, e.has_replay))
            .collect();
        assert_eq!(seen, [(Kind::Run, record, Some(1), false)]);
        assert_eq!(first.events[0].name, "gabe");
        assert_eq!(first.events[0].previous_time, Some(30.0));
        assert!(again.events.is_empty());
    }

    #[sqlx::test]
    async fn a_first_personal_best_has_no_previous_time(db: PgPool) {
        let key = setup(&db).await;
        let start = now(&db).await;
        submit(&db, &key, &run("a", 30.0)).await;

        let page = events(&db, &format!("after={start}")).await;

        assert_eq!(page.events[0].previous_time, None);
    }

    #[sqlx::test]
    async fn max_rank_keeps_only_runs_that_place_that_high_now(db: PgPool) {
        let key = setup(&db).await;
        let start = now(&db).await;
        submit(&db, &key, &run("a", 30.0)).await;
        let second = submit(&db, &key, &by("second", "76561197960287931", "b", 31.0)).await;
        // Gabe improves: the first run is no longer a personal best, so it has no rank.
        let improved = submit(&db, &key, &run("c", 29.0)).await;

        let records = events(&db, &format!("after={start}")).await;
        let top_two = events(&db, &format!("after={start}&max_rank=2")).await;

        let ids = |page: &RecordEvents| page.events.iter().map(|e| e.run_id).collect::<Vec<_>>();
        assert_eq!(ids(&records), [improved]);
        assert_eq!(ids(&top_two), [second, improved]);
        assert_eq!(
            test_client::get(&db, "/v1/records/events?max_rank=0")
                .await
                .status,
            422
        );
        assert_eq!(
            test_client::get(&db, "/v1/records/events?after=nope")
                .await
                .status,
            422
        );
    }

    #[sqlx::test]
    async fn invalidating_and_restoring_a_record_are_reported(db: PgPool) {
        let key = setup(&db).await;
        let record = submit(&db, &key, &run("a", 30.0)).await;
        let not_a_best = submit(&db, &key, &run("b", 31.0)).await;
        let start = now(&db).await;

        invalidate_run(&db, None, not_a_best, Some("test"))
            .await
            .unwrap();
        invalidate_run(&db, None, record, Some("test"))
            .await
            .unwrap();
        let taken = events(&db, &format!("after={start}")).await;
        restore_run(&db, None, record, Some("test")).await.unwrap();
        let restored = events(&db, &format!("after={}", taken.next)).await;

        // The slower run was never on a board, so nobody holds a copy of it.
        let seen = |page: &RecordEvents| {
            page.events
                .iter()
                .map(|e| (e.kind, e.run_id, e.rank))
                .collect::<Vec<_>>()
        };
        assert_eq!(seen(&taken), [(Kind::Invalidated, record, None)]);
        assert_eq!(seen(&restored), [(Kind::Run, record, Some(1))]);
    }

    #[sqlx::test]
    async fn an_event_committed_late_is_not_skipped(db: PgPool) {
        let key = setup(&db).await;
        let early = submit(&db, &key, &run("a", 30.0)).await;
        let late = submit(&db, &key, &by("second", "76561197960287931", "b", 31.0)).await;
        let start = now(&db).await;

        // The first transaction takes the lower event ID but commits after the second.
        let mut slow = db.begin().await.unwrap();
        record(&mut slow, Kind::Replay, &[early]).await.unwrap();
        let mut quick = db.begin().await.unwrap();
        record(&mut quick, Kind::Replay, &[late]).await.unwrap();
        quick.commit().await.unwrap();
        let while_running = events_as_they_are(&db, &format!("after={start}&max_rank=2")).await;
        slow.commit().await.unwrap();
        let after_both = events(&db, &format!("after={}&max_rank=2", while_running.next)).await;

        let ids = |page: &RecordEvents| page.events.iter().map(|e| e.run_id).collect::<Vec<_>>();
        assert!(while_running.events.is_empty());
        assert_eq!(ids(&after_both), [early, late]);
    }
}
