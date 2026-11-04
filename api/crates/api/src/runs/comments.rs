//! Comments on a run, shown on its page. Reading is public. Any signed-in player not banned from posting may
//! comment, reply to a top-level comment (one level deep), and remove their own; the run's player may pin one
//! top-level comment, which then leads the list.
//!
//! Top-level comments page 25 at a time, newest first, each with its first 3 replies; the rest of a comment's
//! replies page oldest first. Comments are plain text, never edited. Removing one hides it and keeps the row.
//! A removed comment that still has replies stays in the list as a placeholder, so the replies still read.
//! Staff remove other players' comments with a reason, logged, in `staff/run_comments.rs`, which also lists
//! removed ones in place.

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::{IntoParams, ToSchema};

use crate::{
    app::AppState,
    auth::sessions::{SignedIn, require_same_origin},
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    players::PlayerRef,
    posts::{Removal, not_banned_from_posting},
};

const PAGE_SIZE: i64 = 25;
/// Replies shown under each comment before Show more.
const FIRST_REPLIES: i64 = 3;
const MAX_BODY_CHARS: usize = 1000;
/// How long a player waits between comments, so one spammer can't fill a page before staff see it.
const WAIT_SECONDS: f64 = 30.0;

const NO_RUN: ApiError = ApiError::NotFound("SourceJump has no such run");
const NO_COMMENT: ApiError = ApiError::NotFound("this run has no such comment");

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunComment {
    pub id: i64,
    pub author: PlayerRef,
    /// Plain text, as written; line breaks are kept.
    pub body: String,
    pub created_at: DateTime<Utc>,
    /// How it was removed. Only staff lists carry removed comments; public ones never do.
    pub removal: Option<Removal>,
}

/// A top-level comment and its replies.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunCommentThread {
    /// The top-level comment's ID, also when it's removed.
    pub id: i64,
    /// None when it was removed and stays only for its replies. Staff lists always carry it.
    pub comment: Option<RunComment>,
    /// The first 3 replies, oldest first.
    pub replies: Vec<RunComment>,
    /// How many replies it has in all.
    pub reply_count: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunCommentList {
    /// The comment the run's player pinned, on the first page only.
    pub pinned: Option<RunCommentThread>,
    /// Newest first, leaving out the pinned one.
    pub threads: Vec<RunCommentThread>,
    /// How many comments and replies the run shows in all.
    pub total: i64,
    /// Pass as `cursor` for the next 25 older threads. None at the end.
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunReplyList {
    /// Oldest first.
    pub replies: Vec<RunComment>,
    /// Pass as `cursor` for the next 25. None at the end.
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct RunCommentsQuery {
    /// A `next_cursor` from an earlier page; for replies, the last reply shown.
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunCommentInput {
    /// Plain text, 1 to 1000 characters once trimmed.
    pub body: String,
    /// The top-level comment this answers. Replies to replies aren't allowed; answer the comment instead.
    pub reply_to: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PinnedCommentInput {
    /// A top-level comment on the run, or None to unpin.
    pub comment: Option<i64>,
}

/// A run's comments: the pinned one, then the rest newest first, each with its first replies.
#[utoipa::path(
    get,
    path = "/v1/runs/{id}/comments",
    tag = "runs",
    params(("id" = i64, Path, description = "SourceJump's run ID"), RunCommentsQuery),
    responses(
        (status = OK, body = RunCommentList),
        (status = NOT_FOUND, description = "SourceJump has no such run", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid cursor", body = ErrorBody),
    ),
)]
pub async fn list_run_comments(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(query): Query<RunCommentsQuery>,
) -> Result<Json<RunCommentList>, ApiError> {
    Ok(Json(threads_page(&state.db, id, &query, false).await?))
}

/// The replies to one comment after the first, oldest first.
#[utoipa::path(
    get,
    path = "/v1/runs/{id}/comments/{comment}/replies",
    tag = "runs",
    params(
        ("id" = i64, Path, description = "SourceJump's run ID"),
        ("comment" = i64, Path, description = "The top-level comment's ID"),
        RunCommentsQuery,
    ),
    responses(
        (status = OK, body = RunReplyList),
        (status = NOT_FOUND, description = "No such comment on this run", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid cursor", body = ErrorBody),
    ),
)]
pub async fn list_run_comment_replies(
    State(state): State<AppState>,
    Path((id, comment)): Path<(i64, i64)>,
    Query(query): Query<RunCommentsQuery>,
) -> Result<Json<RunReplyList>, ApiError> {
    Ok(Json(
        replies_page(&state.db, id, comment, &query, false).await?,
    ))
}

/// Comment on a run, or reply to one of its comments. Any signed-in player may, unless banned from posting,
/// once every 30 seconds.
#[utoipa::path(
    post,
    path = "/v1/runs/{id}/comments",
    tag = "runs",
    params(("id" = i64, Path, description = "SourceJump's run ID")),
    request_body = RunCommentInput,
    responses(
        (status = CREATED, body = RunComment),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Banned from posting, or not from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such run, or no such comment on it to reply to", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Empty, longer than 1000 characters, or a reply to a reply", body = ErrorBody),
        (status = TOO_MANY_REQUESTS, description = "Commented less than 30 seconds ago", body = ErrorBody),
    ),
)]
pub async fn create_run_comment(
    State(state): State<AppState>,
    headers: HeaderMap,
    me: SignedIn,
    Path(id): Path<i64>,
    JsonBody(input): JsonBody<RunCommentInput>,
) -> Result<(StatusCode, Json<RunComment>), ApiError> {
    require_same_origin(&headers, &state.public_url)?;
    not_banned_from_posting(&state, me).await?;
    let body = input.body.trim();
    if body.is_empty() || body.chars().count() > MAX_BODY_CHARS {
        return Err(ApiError::Invalid(format!(
            "a comment is 1 to {MAX_BODY_CHARS} characters"
        )));
    }
    run_exists(&state.db, id).await?;
    if let Some(parent) = input.reply_to
        && replies_to(&state.db, id, parent).await?.is_some()
    {
        return Err(ApiError::Invalid(
            "reply to the comment, not to a reply".to_owned(),
        ));
    }

    let mut tx = state.db.begin().await?;
    // Locking the player's row makes two quick requests take turns, so both can't pass the wait.
    sqlx::query!(
        "SELECT 1 AS locked FROM players WHERE steamid64 = $1 FOR UPDATE",
        me.steamid64.get()
    )
    .fetch_optional(&mut *tx)
    .await?;
    let waiting = sqlx::query_scalar!(
        r#"SELECT EXISTS (
               SELECT 1 FROM run_comments
               WHERE author_steamid64 = $1 AND created_at > now() - make_interval(secs => $2)
           ) AS "waiting!""#,
        me.steamid64.get(),
        WAIT_SECONDS
    )
    .fetch_one(&mut *tx)
    .await?;
    if waiting {
        return Err(ApiError::TooManyRequests(
            "wait 30 seconds between comments",
        ));
    }
    let comment_id = sqlx::query_scalar!(
        "INSERT INTO run_comments (run_id, reply_to, author_steamid64, body) VALUES ($1, $2, $3, $4)
         RETURNING id",
        id,
        input.reply_to,
        me.steamid64.get(),
        body
    )
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    let created = one(&state.db, comment_id).await?.ok_or(NO_COMMENT)?;
    Ok((StatusCode::CREATED, Json(created)))
}

/// Remove your own comment or reply from the run's page. It stays in the database, and a pinned comment is
/// unpinned. Staff remove other players' with `POST /v1/staff/run-comments/{id}/hide`, giving a reason.
#[utoipa::path(
    delete,
    path = "/v1/runs/{id}/comments/{comment}",
    tag = "runs",
    params(
        ("id" = i64, Path, description = "SourceJump's run ID"),
        ("comment" = i64, Path, description = "The comment's ID"),
    ),
    responses(
        (status = NO_CONTENT, description = "Removed"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Not your comment, or banned from posting", body = ErrorBody),
        (status = NOT_FOUND, description = "No such comment on this run, or it was removed already", body = ErrorBody),
    ),
)]
pub async fn hide_run_comment(
    State(state): State<AppState>,
    headers: HeaderMap,
    me: SignedIn,
    Path((id, comment)): Path<(i64, i64)>,
) -> Result<StatusCode, ApiError> {
    require_same_origin(&headers, &state.public_url)?;
    not_banned_from_posting(&state, me).await?;
    let author = sqlx::query_scalar!(
        "SELECT author_steamid64 FROM run_comments WHERE id = $1 AND run_id = $2 AND hidden_at IS NULL",
        comment,
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or(NO_COMMENT)?;
    if author != me.steamid64.get() {
        return Err(ApiError::Forbidden(
            "staff remove other players' comments with a reason",
        ));
    }
    sqlx::query!(
        "UPDATE run_comments SET hidden_at = now(), hidden_by = $2, pinned_at = NULL
         WHERE id = $1 AND hidden_at IS NULL",
        comment,
        me.steamid64.get()
    )
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Pin one of the run's top-level comments, replacing any pinned before, or unpin. Only the run's player may.
#[utoipa::path(
    put,
    path = "/v1/runs/{id}/pinned-comment",
    tag = "runs",
    params(("id" = i64, Path, description = "SourceJump's run ID")),
    request_body = PinnedCommentInput,
    responses(
        (status = NO_CONTENT, description = "Pinned or unpinned"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Not your run, or banned from posting", body = ErrorBody),
        (status = NOT_FOUND, description = "No such run, or no such comment on it", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "A reply, which can't be pinned", body = ErrorBody),
    ),
)]
pub async fn put_pinned_comment(
    State(state): State<AppState>,
    headers: HeaderMap,
    me: SignedIn,
    Path(id): Path<i64>,
    JsonBody(input): JsonBody<PinnedCommentInput>,
) -> Result<StatusCode, ApiError> {
    require_same_origin(&headers, &state.public_url)?;
    not_banned_from_posting(&state, me).await?;
    let runner = sqlx::query_scalar!("SELECT player_steamid64 FROM runs WHERE id = $1", id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(NO_RUN)?;
    if runner != me.steamid64.get() {
        return Err(ApiError::Forbidden("only the run's player pins a comment"));
    }
    if let Some(comment) = input.comment
        && replies_to(&state.db, id, comment).await?.is_some()
    {
        return Err(ApiError::Invalid(
            "a reply can't be pinned, only a comment".to_owned(),
        ));
    }
    let mut tx = state.db.begin().await?;
    sqlx::query!(
        "UPDATE run_comments SET pinned_at = NULL WHERE run_id = $1 AND pinned_at IS NOT NULL",
        id
    )
    .execute(&mut *tx)
    .await?;
    if let Some(comment) = input.comment {
        sqlx::query!(
            "UPDATE run_comments SET pinned_at = now() WHERE id = $1",
            comment
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A page of a run's threads: on the first, the pinned one apart; then 25 others, newest first. Removed
/// comments only `with_removed`, for staff, so the staff list pages exactly like the public one; otherwise a
/// removed comment with shown replies stays as a placeholder.
pub(crate) async fn threads_page(
    db: &PgPool,
    run_id: i64,
    query: &RunCommentsQuery,
    with_removed: bool,
) -> Result<RunCommentList, ApiError> {
    run_exists(db, run_id).await?;
    let before = cursor(query)?;
    let pinned = if before.is_none() {
        rows_of_threads(db, run_id, true, None, with_removed, 1).await?
    } else {
        Vec::new()
    };
    let mut others =
        rows_of_threads(db, run_id, false, before, with_removed, PAGE_SIZE + 1).await?;
    let next_cursor = if others.len() > usize::try_from(PAGE_SIZE).expect("a positive constant") {
        others.pop();
        others.last().map(|row| row.id.to_string())
    } else {
        None
    };

    let ids: Vec<i64> = pinned.iter().chain(&others).map(|row| row.id).collect();
    let mut replies = first_replies(db, &ids, with_removed).await?;
    let counts = reply_counts(db, &ids, with_removed).await?;
    let mut thread = |row: Row| RunCommentThread {
        id: row.id,
        replies: replies.remove(&row.id).unwrap_or_default(),
        reply_count: counts.get(&row.id).copied().unwrap_or(0),
        comment: (with_removed || row.hidden_at.is_none()).then(|| row.into_comment()),
    };
    let pinned = pinned.into_iter().next().map(&mut thread);
    let threads = others.into_iter().map(&mut thread).collect();

    let total = sqlx::query_scalar!(
        r#"SELECT count(*) AS "total!" FROM run_comments WHERE run_id = $1 AND hidden_at IS NULL"#,
        run_id
    )
    .fetch_one(db)
    .await?;
    Ok(RunCommentList {
        pinned,
        threads,
        total,
        next_cursor,
    })
}

/// A page of one comment's replies, oldest first, after the cursor (the last reply shown).
pub(crate) async fn replies_page(
    db: &PgPool,
    run_id: i64,
    comment: i64,
    query: &RunCommentsQuery,
    with_removed: bool,
) -> Result<RunReplyList, ApiError> {
    let is_reply = sqlx::query_scalar!(
        r#"SELECT reply_to IS NOT NULL AS "is_reply!" FROM run_comments WHERE id = $1 AND run_id = $2"#,
        comment,
        run_id
    )
    .fetch_optional(db)
    .await?;
    if is_reply != Some(false) {
        return Err(NO_COMMENT);
    }
    let after = cursor(query)?;
    let mut rows = rows_of_replies(db, &[comment], after, with_removed, PAGE_SIZE + 1).await?;
    let next_cursor = if rows.len() > usize::try_from(PAGE_SIZE).expect("a positive constant") {
        rows.pop();
        rows.last().map(|row| row.id.to_string())
    } else {
        None
    };
    Ok(RunReplyList {
        replies: rows.into_iter().map(Row::into_comment).collect(),
        next_cursor,
    })
}

/// Cursors are a comment's ID; IDs grow with time, so they order comments as dates would.
fn cursor(query: &RunCommentsQuery) -> Result<Option<i64>, ApiError> {
    query
        .cursor
        .as_deref()
        .map(|cursor| {
            cursor
                .parse::<i64>()
                .map_err(|_| ApiError::Invalid("that isn't a comments cursor".to_owned()))
        })
        .transpose()
}

async fn run_exists(db: &PgPool, id: i64) -> Result<(), ApiError> {
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM runs WHERE id = $1) AS "exists!""#,
        id
    )
    .fetch_one(db)
    .await?;
    if exists { Ok(()) } else { Err(NO_RUN) }
}

/// Checks a comment is shown on this run, and gives the comment it replies to: None for a top-level one.
async fn replies_to(db: &PgPool, run_id: i64, comment: i64) -> Result<Option<i64>, ApiError> {
    let row = sqlx::query!(
        "SELECT reply_to FROM run_comments WHERE id = $1 AND run_id = $2 AND hidden_at IS NULL",
        comment,
        run_id
    )
    .fetch_optional(db)
    .await?
    .ok_or(NO_COMMENT)?;
    Ok(row.reply_to)
}

/// One comment as all the queries below read it, with who removed it and why when it was.
struct Row {
    id: i64,
    reply_to: Option<i64>,
    body: String,
    created_at: DateTime<Utc>,
    steamid64: String,
    name: String,
    avatar_url: Option<String>,
    country_code: Option<String>,
    hidden_at: Option<DateTime<Utc>>,
    by_author: bool,
    by_steamid64: Option<String>,
    by_name: Option<String>,
    by_avatar_url: Option<String>,
    by_country_code: Option<String>,
    reason: Option<String>,
}

impl Row {
    fn into_comment(self) -> RunComment {
        RunComment {
            removal: self.hidden_at.map(|hidden_at| Removal {
                hidden_at,
                hidden_by: self
                    .by_steamid64
                    .zip(self.by_name)
                    .map(|(steamid64, name)| PlayerRef {
                        steamid64,
                        name,
                        avatar_url: self.by_avatar_url,
                        country_code: self.by_country_code,
                    }),
                by_author: self.by_author,
                reason: self.reason,
            }),
            id: self.id,
            author: PlayerRef {
                steamid64: self.steamid64,
                name: self.name,
                avatar_url: self.avatar_url,
                country_code: self.country_code,
            },
            body: self.body,
            created_at: self.created_at,
        }
    }
}

// The three queries below select the same columns into `Row`; sqlx checks each against the schema.

/// One comment by ID, removed or not.
async fn one(db: &PgPool, id: i64) -> Result<Option<RunComment>, sqlx::Error> {
    let row = sqlx::query_as!(
        Row,
        r#"
        SELECT c.id, c.reply_to, c.body, c.created_at,
               a.steamid64::text AS "steamid64!", a.name, a.avatar_url, a.country_code,
               c.hidden_at, c.hidden_by IS NOT DISTINCT FROM c.author_steamid64 AS "by_author!",
               h.steamid64::text AS "by_steamid64?", h.name AS "by_name?",
               h.avatar_url AS by_avatar_url, h.country_code AS by_country_code,
               l.reason AS "reason?"
        FROM run_comments c
        JOIN players a ON a.steamid64 = c.author_steamid64
        LEFT JOIN players h ON h.steamid64 = c.hidden_by
        LEFT JOIN staff_log l ON l.id = c.hidden_log_id
        WHERE c.id = $1
        "#,
        id
    )
    .fetch_optional(db)
    .await?;
    Ok(row.map(Row::into_comment))
}

/// Top-level comments, newest first: the pinned one, or the others before a cursor. Without `with_removed`, a
/// removed one is read only when it has shown replies, to stand in for it.
async fn rows_of_threads(
    db: &PgPool,
    run_id: i64,
    pinned: bool,
    before: Option<i64>,
    with_removed: bool,
    limit: i64,
) -> Result<Vec<Row>, sqlx::Error> {
    sqlx::query_as!(
        Row,
        r#"
        SELECT c.id, c.reply_to, c.body, c.created_at,
               a.steamid64::text AS "steamid64!", a.name, a.avatar_url, a.country_code,
               c.hidden_at, c.hidden_by IS NOT DISTINCT FROM c.author_steamid64 AS "by_author!",
               h.steamid64::text AS "by_steamid64?", h.name AS "by_name?",
               h.avatar_url AS by_avatar_url, h.country_code AS by_country_code,
               l.reason AS "reason?"
        FROM run_comments c
        JOIN players a ON a.steamid64 = c.author_steamid64
        LEFT JOIN players h ON h.steamid64 = c.hidden_by
        LEFT JOIN staff_log l ON l.id = c.hidden_log_id
        WHERE c.run_id = $1 AND c.reply_to IS NULL
          AND (c.pinned_at IS NOT NULL) = $2
          AND ($3::bigint IS NULL OR c.id < $3)
          AND ($4 OR c.hidden_at IS NULL
               OR EXISTS (SELECT 1 FROM run_comments r WHERE r.reply_to = c.id AND r.hidden_at IS NULL))
        ORDER BY c.id DESC
        LIMIT $5
        "#,
        run_id,
        pinned,
        before,
        with_removed,
        limit
    )
    .fetch_all(db)
    .await
}

/// Replies to any of `parents`, oldest first: up to `limit` per parent, after a cursor.
async fn rows_of_replies(
    db: &PgPool,
    parents: &[i64],
    after: Option<i64>,
    with_removed: bool,
    limit: i64,
) -> Result<Vec<Row>, sqlx::Error> {
    sqlx::query_as!(
        Row,
        r#"
        SELECT c.id AS "id!", c.reply_to, c.body AS "body!", c.created_at AS "created_at!",
               a.steamid64::text AS "steamid64!", a.name, a.avatar_url, a.country_code,
               c.hidden_at, c.hidden_by IS NOT DISTINCT FROM c.author_steamid64 AS "by_author!",
               h.steamid64::text AS "by_steamid64?", h.name AS "by_name?",
               h.avatar_url AS by_avatar_url, h.country_code AS by_country_code,
               l.reason AS "reason?"
        FROM unnest($1::bigint[]) AS parent (id)
        CROSS JOIN LATERAL (
            SELECT * FROM run_comments r
            WHERE r.reply_to = parent.id
              AND ($2 OR r.hidden_at IS NULL)
              AND ($3::bigint IS NULL OR r.id > $3)
            ORDER BY r.id
            LIMIT $4
        ) c
        JOIN players a ON a.steamid64 = c.author_steamid64
        LEFT JOIN players h ON h.steamid64 = c.hidden_by
        LEFT JOIN staff_log l ON l.id = c.hidden_log_id
        ORDER BY c.reply_to, c.id
        "#,
        parents,
        with_removed,
        after,
        limit
    )
    .fetch_all(db)
    .await
}

/// The first replies of each thread, by the comment they answer.
async fn first_replies(
    db: &PgPool,
    parents: &[i64],
    with_removed: bool,
) -> Result<HashMap<i64, Vec<RunComment>>, sqlx::Error> {
    let mut by_parent: HashMap<i64, Vec<RunComment>> = HashMap::new();
    for row in rows_of_replies(db, parents, None, with_removed, FIRST_REPLIES).await? {
        let parent = row.reply_to.expect("replies answer a comment");
        by_parent
            .entry(parent)
            .or_default()
            .push(row.into_comment());
    }
    Ok(by_parent)
}

async fn reply_counts(
    db: &PgPool,
    parents: &[i64],
    with_removed: bool,
) -> Result<HashMap<i64, i64>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT reply_to AS "reply_to!", count(*) AS "count!" FROM run_comments
           WHERE reply_to = ANY($1) AND ($2 OR hidden_at IS NULL)
           GROUP BY reply_to"#,
        parents,
        with_removed
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.reply_to, row.count))
        .collect())
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::{RunComment, RunCommentList, RunReplyList};
    use crate::{
        auth::sessions,
        players::{
            SteamId64,
            privileges::{self, Privileges},
            restrictions::{Restriction, Restrictions},
        },
        runs::{
            RunAccepted,
            tests::{run, setup},
        },
        staff,
        test_client::{self, TestResponse},
    };

    /// The player `run()` submits for.
    const RUNNER: &str = "76561197960287930";
    const AUTHOR: &str = "76561197960287931";
    const OTHER: &str = "76561197960287932";

    /// A stored run's ID.
    async fn a_run(db: &PgPool) -> i64 {
        let key = setup(db).await;
        let accepted: RunAccepted = test_client::post(db, "/v1/runs", Some(&key), &run("a", 30.0))
            .await
            .json();
        accepted.id
    }

    /// A session for a player with no privileges.
    async fn session(db: &PgPool, steamid: &str) -> String {
        let steamid64 = SteamId64::parse_any(steamid).unwrap();
        // Granting nothing still adds the player, as signing in would.
        privileges::grant(db, steamid64, Privileges::of(&[]))
            .await
            .unwrap();
        sessions::create(db, steamid64).await.unwrap()
    }

    async fn send(
        db: &PgPool,
        method: &str,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> TestResponse {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header("origin", "https://sourcejump.test")
            .header("content-type", "application/json");
        if let Some(token) = token {
            request = request.header("cookie", format!("{}={token}", sessions::COOKIE));
        }
        let body = body.map_or_else(Body::empty, |b| Body::from(b.to_string()));
        test_client::send(db, request.body(body).unwrap()).await
    }

    /// Adds a comment straight to the table, skipping the wait between comments; returns its ID.
    async fn insert(
        db: &PgPool,
        run_id: i64,
        reply_to: Option<i64>,
        author: &str,
        body: &str,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO run_comments (run_id, reply_to, author_steamid64, body)
             VALUES ($1, $2, $3::bigint, $4) RETURNING id",
        )
        .bind(run_id)
        .bind(reply_to)
        .bind(author)
        .bind(body)
        .fetch_one(db)
        .await
        .unwrap()
    }

    async fn list(db: &PgPool, run_id: i64) -> RunCommentList {
        test_client::get(db, &format!("/v1/runs/{run_id}/comments"))
            .await
            .json()
    }

    #[sqlx::test]
    async fn any_signed_in_player_comments_and_removes_their_own(db: PgPool) {
        let run_id = a_run(&db).await;
        let author = session(&db, AUTHOR).await;
        let path = format!("/v1/runs/{run_id}/comments");

        let nice = Some(json!({ "body": "Nice" }));
        assert_eq!(send(&db, "POST", &path, None, nice).await.status, 401);
        let body = Some(json!({ "body": "  Clean run.\nGG  " }));
        let created = send(&db, "POST", &path, Some(&author), body).await;
        assert_eq!(created.status, 201);
        let created: RunComment = created.json();
        assert_eq!(created.body, "Clean run.\nGG");
        assert_eq!(created.author.steamid64, AUTHOR);

        let listed = list(&db, run_id).await;
        assert_eq!(listed.total, 1);
        assert_eq!(listed.threads[0].comment.as_ref().unwrap().id, created.id);

        let own = format!("{path}/{}", created.id);
        let other = session(&db, OTHER).await;
        assert_eq!(
            send(&db, "DELETE", &own, Some(&other), None).await.status,
            403
        );
        assert_eq!(
            send(&db, "DELETE", &own, Some(&author), None).await.status,
            204
        );
        assert_eq!(
            send(&db, "DELETE", &own, Some(&author), None).await.status,
            404
        );
        let listed = list(&db, run_id).await;
        assert_eq!(listed.total, 0);
        assert!(listed.threads.is_empty());
    }

    #[sqlx::test]
    async fn refuses_empty_long_and_too_quick_comments(db: PgPool) {
        let run_id = a_run(&db).await;
        let author = session(&db, AUTHOR).await;
        let path = format!("/v1/runs/{run_id}/comments");
        let comment = |text: &str| Some(json!({ "body": text }));

        for body in ["   ", &"x".repeat(1001)] {
            let response = send(&db, "POST", &path, Some(&author), comment(body)).await;
            assert_eq!(response.status, 422);
        }
        let longest = comment(&"x".repeat(1000));
        assert_eq!(
            send(&db, "POST", &path, Some(&author), longest)
                .await
                .status,
            201
        );
        let again = send(&db, "POST", &path, Some(&author), comment("Again")).await;
        assert_eq!(again.status, 429);
        // Another player isn't held up by the first one's wait.
        let other = session(&db, OTHER).await;
        let theirs = send(&db, "POST", &path, Some(&other), comment("Me too")).await;
        assert_eq!(theirs.status, 201);
        let nowhere = send(
            &db,
            "POST",
            "/v1/runs/999999/comments",
            Some(&other),
            comment("Hi"),
        )
        .await;
        assert_eq!(nowhere.status, 404);
        assert_eq!(
            test_client::get(&db, "/v1/runs/999999/comments")
                .await
                .status,
            404
        );
    }

    #[sqlx::test]
    async fn a_player_banned_from_posting_cant_comment(db: PgPool) {
        let run_id = a_run(&db).await;
        let author = session(&db, AUTHOR).await;
        let path = format!("/v1/runs/{run_id}/comments");
        let before = Some(json!({ "body": "Before" }));
        let created: RunComment = send(&db, "POST", &path, Some(&author), before).await.json();

        let restrictions = Restrictions::of(&[Restriction::NoPosting]);
        let player = SteamId64::parse_any(AUTHOR).unwrap();
        staff::players::ban(&db, None, player, restrictions, "Spam", None, false)
            .await
            .unwrap();

        let after = Some(json!({ "body": "After", "reply_to": created.id }));
        assert_eq!(
            send(&db, "POST", &path, Some(&author), after).await.status,
            403
        );
        let own = format!("{path}/{}", created.id);
        assert_eq!(
            send(&db, "DELETE", &own, Some(&author), None).await.status,
            403
        );
        // What they wrote before the ban stays up.
        assert_eq!(list(&db, run_id).await.total, 1);
    }

    #[sqlx::test]
    async fn pages_threads_25_at_a_time_newest_first(db: PgPool) {
        let run_id = a_run(&db).await;
        session(&db, AUTHOR).await;
        for n in 1..=30 {
            insert(&db, run_id, None, AUTHOR, &format!("Comment {n}")).await;
        }
        let path = format!("/v1/runs/{run_id}/comments");

        let first = list(&db, run_id).await;
        assert_eq!(first.total, 30);
        assert_eq!(first.threads.len(), 25);
        assert_eq!(
            first.threads[0].comment.as_ref().unwrap().body,
            "Comment 30"
        );
        let cursor = first.next_cursor.expect("more comments");

        let second: RunCommentList = test_client::get(&db, &format!("{path}?cursor={cursor}"))
            .await
            .json();
        assert_eq!(second.threads.len(), 5);
        assert_eq!(
            second.threads[4].comment.as_ref().unwrap().body,
            "Comment 1"
        );
        assert_eq!(second.next_cursor, None);
        let bad = test_client::get(&db, &format!("{path}?cursor=abc")).await;
        assert_eq!(bad.status, 422);
    }

    #[sqlx::test]
    async fn replies_go_one_level_deep_with_the_first_three_shown(db: PgPool) {
        let run_id = a_run(&db).await;
        let author = session(&db, AUTHOR).await;
        session(&db, OTHER).await;
        let path = format!("/v1/runs/{run_id}/comments");
        let top = insert(&db, run_id, None, OTHER, "How do you do the skip?").await;
        for n in 1..=4 {
            insert(&db, run_id, Some(top), OTHER, &format!("Reply {n}")).await;
        }

        let reply = Some(json!({ "body": "Hold W", "reply_to": top }));
        let created: RunComment = send(&db, "POST", &path, Some(&author), reply).await.json();

        let listed = list(&db, run_id).await;
        assert_eq!(listed.total, 6);
        assert_eq!(
            listed.threads.len(),
            1,
            "replies aren't threads of their own"
        );
        let thread = &listed.threads[0];
        assert_eq!(thread.reply_count, 5);
        let bodies: Vec<&str> = thread.replies.iter().map(|r| r.body.as_str()).collect();
        assert_eq!(bodies, ["Reply 1", "Reply 2", "Reply 3"]);

        let rest: RunReplyList = test_client::get(
            &db,
            &format!("{path}/{top}/replies?cursor={}", thread.replies[2].id),
        )
        .await
        .json();
        let bodies: Vec<&str> = rest.replies.iter().map(|r| r.body.as_str()).collect();
        assert_eq!(bodies, ["Reply 4", "Hold W"]);
        assert_eq!(rest.next_cursor, None);

        sqlx::query("UPDATE run_comments SET created_at = now() - interval '1 minute'")
            .execute(&db)
            .await
            .unwrap();
        let nested = Some(json!({ "body": "No", "reply_to": created.id }));
        assert_eq!(
            send(&db, "POST", &path, Some(&author), nested).await.status,
            422
        );
        let replies_of_a_reply = format!("{path}/{}/replies", created.id);
        assert_eq!(test_client::get(&db, &replies_of_a_reply).await.status, 404);
    }

    #[sqlx::test]
    async fn a_removed_comment_with_replies_stays_as_a_placeholder(db: PgPool) {
        let run_id = a_run(&db).await;
        let author = session(&db, AUTHOR).await;
        session(&db, OTHER).await;
        let answered = insert(&db, run_id, None, AUTHOR, "Answered").await;
        insert(&db, run_id, Some(answered), OTHER, "An answer").await;
        let alone = insert(&db, run_id, None, AUTHOR, "Alone").await;
        for id in [answered, alone] {
            let own = format!("/v1/runs/{run_id}/comments/{id}");
            assert_eq!(
                send(&db, "DELETE", &own, Some(&author), None).await.status,
                204
            );
        }

        let listed = list(&db, run_id).await;
        assert_eq!(listed.total, 1);
        assert_eq!(listed.threads.len(), 1);
        let placeholder = &listed.threads[0];
        assert_eq!(placeholder.id, answered);
        assert!(placeholder.comment.is_none(), "its text isn't shown");
        assert_eq!(placeholder.replies[0].body, "An answer");

        // Nobody replies to it any more.
        let reply = Some(json!({ "body": "Late", "reply_to": answered }));
        let path = format!("/v1/runs/{run_id}/comments");
        assert_eq!(
            send(&db, "POST", &path, Some(&author), reply).await.status,
            404
        );
    }

    #[sqlx::test]
    async fn the_runs_player_pins_one_comment_which_leads(db: PgPool) {
        let run_id = a_run(&db).await;
        let runner = session(&db, RUNNER).await;
        let other = session(&db, OTHER).await;
        let first = insert(&db, run_id, None, OTHER, "First").await;
        let second = insert(&db, run_id, None, OTHER, "Second").await;
        let reply = insert(&db, run_id, Some(first), OTHER, "A reply").await;
        let pin = format!("/v1/runs/{run_id}/pinned-comment");

        let first_pin = Some(json!({ "comment": first }));
        assert_eq!(
            send(&db, "PUT", &pin, Some(&other), first_pin.clone())
                .await
                .status,
            403
        );
        assert_eq!(
            send(&db, "PUT", &pin, Some(&runner), first_pin)
                .await
                .status,
            204
        );
        let listed = list(&db, run_id).await;
        let pinned = listed.pinned.expect("a pinned comment");
        assert_eq!(pinned.id, first);
        assert_eq!(pinned.replies.len(), 1);
        let ids: Vec<i64> = listed.threads.iter().map(|t| t.id).collect();
        assert_eq!(ids, [second], "the pinned one isn't listed twice");

        let reply_pin = Some(json!({ "comment": reply }));
        assert_eq!(
            send(&db, "PUT", &pin, Some(&runner), reply_pin)
                .await
                .status,
            422
        );
        // Pinning another replaces it.
        let second_pin = Some(json!({ "comment": second }));
        assert_eq!(
            send(&db, "PUT", &pin, Some(&runner), second_pin)
                .await
                .status,
            204
        );
        assert_eq!(list(&db, run_id).await.pinned.unwrap().id, second);

        // Removing the pinned comment unpins it.
        let own = format!("/v1/runs/{run_id}/comments/{second}");
        assert_eq!(
            send(&db, "DELETE", &own, Some(&other), None).await.status,
            204
        );
        assert!(list(&db, run_id).await.pinned.is_none());

        let unpin = Some(json!({ "comment": null }));
        assert_eq!(
            send(&db, "PUT", &pin, Some(&runner), unpin).await.status,
            204
        );
    }
}
