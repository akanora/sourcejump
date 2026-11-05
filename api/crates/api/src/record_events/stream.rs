//! `GET /v1/records/stream`: the record events pushed as server-sent events, for servers that hold a connection
//! open instead of polling.
//!
//! One reader serves every open stream. A Postgres `LISTEN` connection wakes it when an event commits; it reads
//! the new events once, at every rank a stream may ask for, and hands the batch to each stream, which keeps
//! what its `max_rank` asks for. So each event costs one read however many streams are open, where every
//! stream used to read for itself and hundreds of them could queue on the pool (backend audit 2026-11-05).
//! A stream reads the log itself only to catch up: when it opens, and when it falls behind the reader's
//! batches. Nothing is kept beyond a few batches in memory, so a stream that reconnects with `Last-Event-ID`
//! after a restart misses nothing. The reader also looks every 30 seconds without being woken: a notification
//! can come while the listener reconnects, or before an older transaction elsewhere lets the event be read.
//!
//! One address may hold `MAX_STREAMS_PER_ADDRESS` streams: a server opens one, and up to 32 share an IP.

use std::{
    collections::{HashMap, VecDeque},
    convert::Infallible,
    net::IpAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
};
use futures_util::{Stream, stream};
use serde::Deserialize;
use sqlx::{PgPool, postgres::PgListener};
use tokio::sync::{broadcast, watch};
use utoipa::IntoParams;

use super::{Cursor, Kind, MAX_MAX_RANK, RecordEvent, caught_up, check_max_rank, page};
use crate::{app::AppState, client_address::ClientAddress, error::ApiError, error::ErrorBody};

/// How often the reader looks for events it wasn't woken for.
const LOOK_AGAIN: Duration = Duration::from_secs(30);
/// Below Cloudflare's 100 s limit for an idle connection.
const KEEP_ALIVE: Duration = Duration::from_secs(15);
const LISTEN_RETRY: Duration = Duration::from_secs(5);
/// Batches kept for streams that are slow to take them; one further behind reads the log to catch up.
const BATCHES_KEPT: usize = 64;
/// A server holds one stream, and one IP may run 32 servers (`servers/heartbeat.rs`).
const MAX_STREAMS_PER_ADDRESS: usize = 40;
/// Every open stream holds a connection to Cloudflare and a task here, so all of them together are capped too.
const MAX_STREAMS: usize = 2000;

/// Changes whenever record events commit. Its sender is dropped at shutdown, which ends the reader and with it
/// every open stream, so they don't hold the API up.
pub type Wake = watch::Receiver<()>;

/// Listens for committed record events and wakes the reader, for as long as it runs. Reconnects on its own.
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

/// What the reader read in one go: every event after `from` up to `to`, each with its place in the log.
#[derive(Clone)]
struct Batch {
    from: Cursor,
    to: Cursor,
    events: Arc<Vec<(Cursor, RecordEvent)>>,
}

/// Where streams get the reader's batches. Cloning it shares the same feed.
pub struct Feed(broadcast::Receiver<Batch>);

impl Clone for Feed {
    fn clone(&self) -> Self {
        Self(self.0.resubscribe())
    }
}

impl Feed {
    /// Starts the reader on `db`, woken by `wake`. It runs until `wake`'s sender is dropped.
    pub fn start(db: PgPool, wake: Wake) -> Self {
        let (batches, feed) = broadcast::channel(BATCHES_KEPT);
        tokio::spawn(read(db, wake, batches));
        Self(feed)
    }

    /// A feed with no reader: streams on it end once they've caught up. For tests that don't stream.
    #[cfg(test)]
    pub fn closed() -> Self {
        Self(broadcast::channel(1).1)
    }

    fn subscribe(&self) -> broadcast::Receiver<Batch> {
        self.0.resubscribe()
    }
}

/// The reader: reads what committed after its last read, at every rank, and hands it to every stream.
async fn read(db: PgPool, mut wake: Wake, batches: broadcast::Sender<Batch>) {
    let mut after = loop {
        match async { caught_up(&mut *db.acquire().await?).await }.await {
            Ok(now) => break now,
            Err(error) => {
                tracing::warn!(%error, "record stream reader can't start; trying again");
                tokio::time::sleep(LISTEN_RETRY).await;
            }
        }
    };
    loop {
        // Marked seen before reading, so an event committing during the read wakes the next wait.
        wake.borrow_and_update();
        let read = async {
            let mut conn = db.acquire().await?;
            page(&mut conn, after, MAX_MAX_RANK).await
        };
        match read.await {
            Ok((events, next)) => {
                let full = i64::try_from(events.len()) == Ok(super::PAGE_SIZE);
                if next != after {
                    let events = events
                        .into_iter()
                        // `page` writes each event's cursor as its id, so every one parses.
                        .filter_map(|event| {
                            Some((Cursor::try_from(event.id.as_str()).ok()?, event))
                        })
                        .collect();
                    // No streams open is fine: nobody needed the batch.
                    let _ = batches.send(Batch {
                        from: after,
                        to: next,
                        events: Arc::new(events),
                    });
                    after = next;
                }
                if full {
                    continue;
                }
            }
            Err(error) => {
                tracing::warn!(%error, "record stream reader's read failed; trying again");
            }
        }
        tokio::select! {
            woken = wake.changed() => if woken.is_err() { return },
            () = tokio::time::sleep(LOOK_AGAIN) => {}
        }
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
        (status = TOO_MANY_REQUESTS, description = "This address has the most streams open that one may", body = ErrorBody),
    ),
)]
pub async fn record_stream(
    State(state): State<AppState>,
    address: ClientAddress,
    Query(query): Query<RecordStreamQuery>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let max_rank = check_max_rank(query.max_rank)?;
    let slot = state
        .stream_slots
        .take(address)
        .ok_or(ApiError::TooManyRequests(
            "too many record streams open from this address; try again later",
        ))?;
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
        // Subscribed before the stream's first read, so no batch falls between the two.
        batches: state.record_feed.subscribe(),
        caught_up: false,
        after,
        max_rank,
        pending: VecDeque::new(),
        _slot: slot,
    };
    Ok(Sse::new(stream::unfold(follow, Follow::next))
        .keep_alive(KeepAlive::new().interval(KEEP_ALIVE)))
}

/// One open stream: where it has got to, and the events read but not sent yet.
struct Follow {
    db: PgPool,
    batches: broadcast::Receiver<Batch>,
    /// Whether the stream has read the log up to the reader's batches, so the next batch carries on from it.
    caught_up: bool,
    after: Cursor,
    max_rank: i64,
    pending: VecDeque<RecordEvent>,
    /// Its place among the open streams, given back when the stream ends.
    _slot: StreamSlot,
}

impl Follow {
    /// The next event to send, waiting for one if need be. None ends the stream: at shutdown, or when the
    /// database fails, after which the client reconnects with `Last-Event-ID`.
    async fn next(mut self) -> Option<(Result<Event, Infallible>, Self)> {
        loop {
            if let Some(event) = self.pending.pop_front() {
                return Some((Ok(sse_event(&event)), self));
            }
            if !self.caught_up {
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
                // A full page means more are waiting; otherwise the log is read up to now.
                self.caught_up = i64::try_from(events.len()) != Ok(super::PAGE_SIZE);
                self.after = next;
                self.pending.extend(events);
                continue;
            }
            match self.batches.recv().await {
                Ok(batch) => self.take(&batch),
                // Further behind than the batches kept: read the log instead.
                Err(broadcast::error::RecvError::Lagged(_)) => self.caught_up = false,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    }

    /// Keeps a batch's events past this stream's place that its `max_rank` asks for. A batch that starts after
    /// that place left a gap, read from the log instead; one that ends before it is old news.
    fn take(&mut self, batch: &Batch) {
        if batch.to <= self.after {
            return;
        }
        if batch.from > self.after {
            self.caught_up = false;
            return;
        }
        let wanted = batch.events.iter().filter(|(at, event)| {
            *at > self.after
                && (event.kind == Kind::Invalidated
                    || event.rank.is_some_and(|rank| rank <= self.max_rank))
        });
        self.pending.extend(wanted.map(|(_, event)| event.clone()));
        self.after = batch.to;
    }
}

fn sse_event(event: &RecordEvent) -> Event {
    Event::default()
        .id(&event.id)
        .event(event.kind.name())
        .json_data(event)
        .expect("a record event serializes")
}

/// How many streams are open, per address and in all.
#[derive(Clone, Default)]
pub struct StreamSlots(Arc<Mutex<Slots>>);

#[derive(Default)]
struct Slots {
    by_address: HashMap<IpAddr, usize>,
    open: usize,
}

/// One open stream's place. Dropping it frees the place.
pub struct StreamSlot {
    slots: StreamSlots,
    address: IpAddr,
}

impl StreamSlots {
    fn take(&self, address: ClientAddress) -> Option<StreamSlot> {
        let address = address.block();
        let mut slots = self
            .0
            .lock()
            .expect("no code panics while holding the lock");
        let held = slots.by_address.get(&address).copied().unwrap_or(0);
        if held >= MAX_STREAMS_PER_ADDRESS || slots.open >= MAX_STREAMS {
            return None;
        }
        slots.by_address.insert(address, held + 1);
        slots.open += 1;
        Some(StreamSlot {
            slots: self.clone(),
            address,
        })
    }
}

impl Drop for StreamSlot {
    fn drop(&mut self) {
        let mut slots = self
            .slots
            .0
            .lock()
            .expect("no code panics while holding the lock");
        slots.open -= 1;
        if let Some(held) = slots.by_address.get_mut(&self.address) {
            *held -= 1;
            if *held == 0 {
                slots.by_address.remove(&self.address);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use sqlx::PgPool;
    use tokio::sync::watch;

    use super::{super::RecordEvent, Feed};
    use crate::{
        app::AppState,
        runs::tests::{run, setup},
        test_client,
    };

    #[sqlx::test]
    async fn sends_events_as_they_commit_and_ends_at_shutdown(db: PgPool) {
        let key = setup(&db).await;
        let (wake, woken) = watch::channel(());
        let state = AppState {
            record_feed: Feed::start(db.clone(), woken),
            ..AppState::for_tests(db.clone())
        };
        let start = test_client::get(&db, "/v1/records/events")
            .await
            .json::<serde_json::Value>()["next"]
            .as_str()
            .unwrap()
            .to_owned();
        let response = test_client::send_to_raw(
            state,
            Request::get("/v1/records/stream")
                .header("last-event-id", &start)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
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

    /// Opens a stream from `ip` and returns its status and body.
    async fn open(state: &AppState, ip: &str, query: &str) -> (u16, Body) {
        let response = test_client::send_to_raw(
            state.clone(),
            Request::get(format!("/v1/records/stream{query}"))
                .header("x-forwarded-for", ip)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        (response.status().as_u16(), response.into_body())
    }

    /// The first `count` events on `body`, as (time, rank). An event becomes readable once every transaction
    /// older than it has ended, including other tests', so this wakes the reader until they arrive, as Postgres
    /// would.
    async fn events(
        body: &mut Body,
        wake: &watch::Sender<()>,
        count: usize,
    ) -> Vec<(f64, Option<i64>)> {
        let mut events = Vec::new();
        let read = async {
            while events.len() < count {
                wake.send_replace(());
                let frame = tokio::select! {
                    frame = body.frame() => frame,
                    () = tokio::time::sleep(Duration::from_millis(100)) => continue,
                };
                let Some(Ok(frame)) = frame else { break };
                let Ok(data) = frame.into_data() else {
                    continue;
                };
                let text = String::from_utf8(data.to_vec()).unwrap();
                for line in text.lines().filter_map(|line| line.strip_prefix("data: ")) {
                    let event: RecordEvent = serde_json::from_str(line).unwrap();
                    events.push((event.time, event.rank));
                }
            }
        };
        let _ = tokio::time::timeout(Duration::from_secs(10), read).await;
        events
    }

    #[sqlx::test]
    async fn streams_share_one_reader_and_keep_their_own_ranks(db: PgPool) {
        let key = setup(&db).await;
        let (wake, woken) = watch::channel(());
        let state = AppState {
            record_feed: Feed::start(db.clone(), woken),
            ..AppState::for_tests(db.clone())
        };
        let (status, mut records) = open(&state, "203.0.113.1", "?max_rank=1").await;
        assert_eq!(status, 200);
        let (status, mut top_two) = open(&state, "203.0.113.2", "?max_rank=2").await;
        assert_eq!(status, 200);

        let mut faster = run("a", 30.0);
        faster["player"]["steamid64"] = serde_json::json!("76561197960287930");
        let mut slower = run("b", 31.0);
        slower["player"]["steamid64"] = serde_json::json!("76561197960287931");
        test_client::post(&db, "/v1/runs", Some(&key), &faster).await;
        test_client::post(&db, "/v1/runs", Some(&key), &slower).await;

        assert_eq!(
            events(&mut top_two, &wake, 2).await,
            [(30.0, Some(1)), (31.0, Some(2))]
        );
        // Both runs have been read by now; the record stream takes only the first.
        assert_eq!(events(&mut records, &wake, 2).await, [(30.0, Some(1))]);
    }

    #[sqlx::test]
    async fn caps_the_streams_one_address_holds(db: PgPool) {
        let (_wake, woken) = watch::channel(());
        let state = AppState {
            record_feed: Feed::start(db.clone(), woken),
            ..AppState::for_tests(db.clone())
        };
        let mut held = Vec::new();
        for _ in 0..super::MAX_STREAMS_PER_ADDRESS {
            let (status, body) = open(&state, "203.0.113.7", "").await;
            assert_eq!(status, 200);
            held.push(body);
        }
        assert_eq!(open(&state, "203.0.113.7", "").await.0, 429);
        assert_eq!(
            open(&state, "2001:db8::1", "").await.0,
            200,
            "other addresses are apart"
        );

        // Closing a stream frees its place.
        drop(held.pop());
        assert_eq!(open(&state, "203.0.113.7", "").await.0, 200);
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
