//! `GET /v1/records/stream`: the record events pushed as server-sent events, for servers that hold a connection
//! open instead of polling.
//!
//! One Postgres `LISTEN` connection wakes every open stream when an event commits; each stream then reads the
//! log after its own cursor with the same query as polling. Nothing is kept in memory, so a stream that
//! reconnects with `Last-Event-ID` after a restart misses nothing. A stream also looks every 30 seconds
//! without being woken: a notification can come while the listener reconnects, or before an older
//! transaction elsewhere lets the event be read.

use std::{collections::VecDeque, convert::Infallible, time::Duration};

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::{Stream, stream};
use serde::Deserialize;
use sqlx::{PgPool, postgres::PgListener};
use tokio::sync::watch;
use utoipa::IntoParams;

use super::{Cursor, RecordEvent, caught_up, check_max_rank, page};
use crate::{app::AppState, error::ApiError, error::ErrorBody};

/// How often an idle stream looks for events it wasn't woken for. Every open stream reads this often, so it's
/// kept long: notifications cover nearly every event, and this only catches the rare one they miss.
const LOOK_AGAIN: Duration = Duration::from_secs(30);
/// Below Cloudflare's 100 s limit for an idle connection.
const KEEP_ALIVE: Duration = Duration::from_secs(15);
const LISTEN_RETRY: Duration = Duration::from_secs(5);

/// Changes whenever record events commit. Streams end when its sender is dropped, which happens at shutdown so
/// open streams don't hold the API up.
pub type Wake = watch::Receiver<()>;

/// Listens for committed record events and wakes open streams, for as long as it runs. Reconnects on its own.
pub async fn listen(db: PgPool, wake: watch::Sender<()>) {
    loop {
        if let Err(error) = forward_notifications(&db, &wake).await {
            tracing::warn!(%error, "record events listener lost; reconnecting");
        }
        tokio::time::sleep(LISTEN_RETRY).await;
    }
}

async fn forward_notifications(db: &PgPool, wake: &watch::Sender<()>) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect_with(db).await?;
    listener.listen("record_events").await?;
    // Anything that committed while there was no listener.
    wake.send_replace(());
    loop {
        listener.recv().await?;
        wake.send_replace(());
    }
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct RecordStreamQuery {
    /// Where to start, as for polling: a `next` or event `id`. A `Last-Event-ID` header wins over it. Neither:
    /// from now.
    after: Option<String>,
    /// Only runs that are now at this rank or better on their board, 1 to 100. Default 1, world records.
    /// `invalidated` events are always sent.
    max_rank: Option<i64>,
}

/// The record events as server-sent events: `event:` is the kind, `id:` the event's cursor and `data:` the
/// event as `GET /v1/records/events` gives it. A comment every 15 s keeps proxies from closing the connection.
/// Reconnect with `Last-Event-ID` to carry on where it stopped. No key needed.
#[utoipa::path(
    get,
    path = "/v1/records/stream",
    tag = "records",
    params(
        RecordStreamQuery,
        ("Last-Event-ID" = Option<String>, Header, description = "The last event's `id`, to resume after it"),
    ),
    responses(
        (status = OK, description = "Server-sent events, each holding a `RecordEvent`", content_type = "text/event-stream", body = String),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid cursor or max_rank", body = ErrorBody),
    ),
)]
pub async fn record_stream(
    State(state): State<AppState>,
    Query(query): Query<RecordStreamQuery>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let max_rank = check_max_rank(query.max_rank)?;
    let resume = headers
        .get("last-event-id")
        .map(|value| value.to_str().unwrap_or_default())
        .or(query.after.as_deref());
    let after = match resume {
        Some(cursor) => Cursor::try_from(cursor)?,
        None => caught_up(&mut *state.db.acquire().await?).await?,
    };
    let follow = Follow {
        db: state.db,
        wake: state.record_events,
        after,
        max_rank,
        pending: VecDeque::new(),
    };
    Ok(Sse::new(stream::unfold(follow, Follow::next))
        .keep_alive(KeepAlive::new().interval(KEEP_ALIVE)))
}

/// One open stream: where it has got to, and the events read but not sent yet.
struct Follow {
    db: PgPool,
    wake: Wake,
    after: Cursor,
    max_rank: i64,
    pending: VecDeque<RecordEvent>,
}

impl Follow {
    /// The next event to send, waiting for one if need be. None ends the stream: at shutdown, or when the
    /// database fails, after which the client reconnects with `Last-Event-ID`.
    async fn next(mut self) -> Option<(Result<Event, Infallible>, Self)> {
        loop {
            if let Some(event) = self.pending.pop_front() {
                return Some((Ok(sse_event(&event)), self));
            }
            // Marked seen before reading, so an event committing during the read wakes the next wait.
            self.wake.borrow_and_update();
            let read = async {
                let mut conn = self.db.acquire().await?;
                page(&mut conn, self.after, self.max_rank).await
            };
            let (events, next) = match read.await {
                Ok(read) => read,
                Err(error) => {
                    tracing::warn!(%error, "record stream ended by a failed read");
                    return None;
                }
            };
            self.after = next;
            if events.is_empty() {
                tokio::select! {
                    woken = self.wake.changed() => woken.ok()?,
                    () = tokio::time::sleep(LOOK_AGAIN) => {}
                }
            }
            self.pending.extend(events);
        }
    }
}

fn sse_event(event: &RecordEvent) -> Event {
    Event::default()
        .id(&event.id)
        .event(event.kind.name())
        .json_data(event)
        .expect("a record event serializes")
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use sqlx::PgPool;
    use tokio::sync::watch;
    use tower::ServiceExt;

    use super::super::RecordEvent;
    use crate::{
        app::{self, AppState},
        runs::tests::{run, setup},
        test_client,
    };

    #[sqlx::test]
    async fn sends_events_as_they_commit_and_ends_at_shutdown(db: PgPool) {
        let key = setup(&db).await;
        let (wake, woken) = watch::channel(());
        let state = AppState {
            record_events: woken,
            ..AppState::for_tests(db.clone())
        };
        let start = test_client::get(&db, "/v1/records/events")
            .await
            .json::<serde_json::Value>()["next"]
            .as_str()
            .unwrap()
            .to_owned();
        let response = app::router(state)
            .oneshot(
                Request::get("/v1/records/stream")
                    .header("last-event-id", &start)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        let mut body = response.into_body();

        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;
        // Postgres notifies a real listener; here the test wakes the stream until the event can be read.
        let frame = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                wake.send_replace(());
                tokio::select! {
                    frame = body.frame() => break frame,
                    () = tokio::time::sleep(Duration::from_millis(100)) => {}
                }
            }
        })
        .await
        .expect("the event arrives")
        .unwrap()
        .unwrap()
        .into_data()
        .unwrap();
        let text = String::from_utf8(frame.to_vec()).unwrap();
        let data = text
            .lines()
            .find_map(|line| line.strip_prefix("data: "))
            .unwrap();
        let event: RecordEvent = serde_json::from_str(data).unwrap();

        assert!(text.contains("event: run\n"));
        assert!(text.contains(&format!("id: {}\n", event.id)));
        assert_eq!((event.time, event.rank), (30.0, Some(1)));

        drop(wake);
        let end = tokio::time::timeout(Duration::from_secs(10), async {
            while let Some(frame) = body.frame().await {
                // Keep-alive comments may come first.
                assert!(frame.unwrap().into_data().unwrap().starts_with(b":"));
            }
        })
        .await;
        assert!(end.is_ok(), "the stream ends once its wake sender is gone");
    }

    #[sqlx::test]
    async fn a_bad_cursor_is_refused_before_streaming(db: PgPool) {
        let response = test_client::send(
            &db,
            Request::get("/v1/records/stream")
                .header("last-event-id", "nope")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status, 422);
    }
}
