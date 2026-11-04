//! Staff tools for run comments (`manage_posts`, as for community posts): a run's comments with removed ones in
//! place, removing someone else's comment with a reason, and restoring one staff removed.
//!
//! As with posts, a comment its author removed stays removed, and nobody restores their own. Replies are
//! comments too, removed and restored the same way. A removal by staff
//! links its staff log entry in `run_comments.hidden_log_id`.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde_json::json;
use sqlx::PgPool;

use super::{
    ChangeError,
    access::Staff,
    log::{self, StaffAction, check_reason},
    posts::PostReason,
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    players::{SteamId64, privileges::Privilege},
    runs::comments::{self, RunCommentList, RunCommentsQuery, RunReplyList},
};

/// Removes someone else's comment from the run's page and logs it with the reason. A pinned comment is
/// unpinned; restoring it doesn't pin it again.
pub async fn hide(db: &PgPool, actor: SteamId64, id: i64, reason: &str) -> Result<(), ChangeError> {
    let mut tx = db.begin().await?;
    let comment = sqlx::query!(
        "SELECT c.run_id, c.body, c.author_steamid64, a.name AS author_name
         FROM run_comments c JOIN players a ON a.steamid64 = c.author_steamid64
         WHERE c.id = $1 AND c.hidden_at IS NULL FOR UPDATE OF c",
        id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ChangeError::NotFound(
        "there's no such comment, or it was removed already",
    ))?;
    if comment.author_steamid64 == actor.get() {
        return Err(ChangeError::Invalid(
            "remove your own comments as their author".to_owned(),
        ));
    }
    let entry = log::Entry {
        actor: Some(actor),
        action: StaffAction::HideRunComment,
        target: &id.to_string(),
        reason: Some(reason),
        detail: json!({
            "run": comment.run_id.to_string(),
            "body": comment.body,
            "author": comment.author_steamid64.to_string(),
            "author_name": comment.author_name,
        }),
    };
    let log_id = log::record(&mut tx, entry).await?;
    sqlx::query!(
        "UPDATE run_comments SET hidden_at = now(), hidden_by = $2, hidden_log_id = $3, pinned_at = NULL
         WHERE id = $1",
        id,
        actor.get(),
        log_id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Puts a comment staff removed back on the run's page and logs it.
pub async fn restore(
    db: &PgPool,
    actor: SteamId64,
    id: i64,
    reason: &str,
) -> Result<(), ChangeError> {
    let mut tx = db.begin().await?;
    let comment = sqlx::query!(
        r#"SELECT c.run_id, c.body, c.author_steamid64, a.name AS author_name,
                  c.hidden_by IS NOT DISTINCT FROM c.author_steamid64 AS "by_author!"
           FROM run_comments c JOIN players a ON a.steamid64 = c.author_steamid64
           WHERE c.id = $1 AND c.hidden_at IS NOT NULL FOR UPDATE OF c"#,
        id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ChangeError::NotFound("there's no such removed comment"))?;
    if comment.by_author {
        return Err(ChangeError::Invalid(
            "its author removed it, so it stays removed".to_owned(),
        ));
    }
    if comment.author_steamid64 == actor.get() {
        return Err(ChangeError::Invalid(
            "you can't restore your own comment".to_owned(),
        ));
    }
    let entry = log::Entry {
        actor: Some(actor),
        action: StaffAction::RestoreRunComment,
        target: &id.to_string(),
        reason: Some(reason),
        detail: json!({
            "run": comment.run_id.to_string(),
            "body": comment.body,
            "author": comment.author_steamid64.to_string(),
            "author_name": comment.author_name,
        }),
    };
    log::record(&mut tx, entry).await?;
    sqlx::query!(
        "UPDATE run_comments SET hidden_at = NULL, hidden_by = NULL, hidden_log_id = NULL WHERE id = $1",
        id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// A run's comments as its page lists them, with removed ones in their place. Staff with `manage_posts` see
/// these there instead of the public list.
#[utoipa::path(
    get,
    path = "/v1/staff/runs/{id}/comments",
    tag = "staff",
    params(("id" = i64, Path, description = "SourceJump's run ID"), RunCommentsQuery),
    responses(
        (status = OK, body = RunCommentList),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_posts", body = ErrorBody),
        (status = NOT_FOUND, description = "No such run", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid cursor", body = ErrorBody),
    ),
)]
pub async fn list_staff_run_comments(
    State(state): State<AppState>,
    staff: Staff,
    Path(id): Path<i64>,
    Query(query): Query<RunCommentsQuery>,
) -> Result<Json<RunCommentList>, ApiError> {
    staff.require(Privilege::ManagePosts)?;
    Ok(Json(
        comments::threads_page(&state.db, id, &query, true).await?,
    ))
}

/// One comment's replies after the first, removed ones in place.
#[utoipa::path(
    get,
    path = "/v1/staff/runs/{id}/comments/{comment}/replies",
    tag = "staff",
    params(
        ("id" = i64, Path, description = "SourceJump's run ID"),
        ("comment" = i64, Path, description = "The top-level comment's ID"),
        RunCommentsQuery,
    ),
    responses(
        (status = OK, body = RunReplyList),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_posts", body = ErrorBody),
        (status = NOT_FOUND, description = "No such comment on this run", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid cursor", body = ErrorBody),
    ),
)]
pub async fn list_staff_run_comment_replies(
    State(state): State<AppState>,
    staff: Staff,
    Path((id, comment)): Path<(i64, i64)>,
    Query(query): Query<RunCommentsQuery>,
) -> Result<Json<RunReplyList>, ApiError> {
    staff.require(Privilege::ManagePosts)?;
    Ok(Json(
        comments::replies_page(&state.db, id, comment, &query, true).await?,
    ))
}

/// Remove another player's comment from the run's page. It stays in the database and can be restored.
#[utoipa::path(
    post,
    path = "/v1/staff/run-comments/{id}/hide",
    tag = "staff",
    params(("id" = i64, Path, description = "The comment's ID")),
    request_body = PostReason,
    responses(
        (status = NO_CONTENT, description = "Removed"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_posts, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such comment, or it was removed already", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Your own comment, or no reason", body = ErrorBody),
    ),
)]
pub async fn post_hide_run_comment(
    State(state): State<AppState>,
    staff: Staff,
    Path(id): Path<i64>,
    JsonBody(request): JsonBody<PostReason>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManagePosts)?;
    let reason = check_reason(&request.reason)?;
    hide(&state.db, staff.steamid64, id, &reason).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Put a comment staff removed back on the run's page.
#[utoipa::path(
    post,
    path = "/v1/staff/run-comments/{id}/restore",
    tag = "staff",
    params(("id" = i64, Path, description = "The comment's ID")),
    request_body = PostReason,
    responses(
        (status = NO_CONTENT, description = "Restored"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_posts, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such removed comment", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Removed by its author, your own, or no reason", body = ErrorBody),
    ),
)]
pub async fn post_restore_run_comment(
    State(state): State<AppState>,
    staff: Staff,
    Path(id): Path<i64>,
    JsonBody(request): JsonBody<PostReason>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManagePosts)?;
    let reason = check_reason(&request.reason)?;
    restore(&state.db, staff.steamid64, id, &reason).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::{Value, json};

    use super::*;
    use crate::{
        auth::sessions,
        players::privileges::{self, Privileges},
        runs::{
            RunAccepted,
            comments::RunCommentList,
            tests::{run, setup},
        },
        staff::log::LogEntries,
        test_client::{self, TestResponse},
    };

    const STAFF: &str = "76561197960287920";
    const AUTHOR: &str = "76561197960287931";

    async fn session(db: &PgPool, steamid: &str, held: &[Privilege]) -> String {
        let steamid64 = SteamId64::parse_any(steamid).unwrap();
        privileges::grant(db, steamid64, Privileges::of(held))
            .await
            .unwrap();
        sessions::create(db, steamid64).await.unwrap()
    }

    async fn send(
        db: &PgPool,
        method: &str,
        path: &str,
        token: &str,
        body: Option<Value>,
    ) -> TestResponse {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header("origin", "https://sourcejump.test")
            .header("content-type", "application/json")
            .header("cookie", format!("{}={token}", sessions::COOKIE))
            .body(body.map_or_else(Body::empty, |b| Body::from(b.to_string())))
            .unwrap();
        test_client::send(db, request).await
    }

    /// A run with one comment by AUTHOR: the run's and the comment's IDs.
    async fn commented_run(db: &PgPool, author: &str) -> (i64, i64) {
        let key = setup(db).await;
        let accepted: RunAccepted = test_client::post(db, "/v1/runs", Some(&key), &run("a", 30.0))
            .await
            .json();
        let path = format!("/v1/runs/{}/comments", accepted.id);
        let created = send(db, "POST", &path, author, Some(json!({ "body": "Spam" }))).await;
        assert_eq!(created.status, 201);
        (accepted.id, created.json::<Value>()["id"].as_i64().unwrap())
    }

    fn reason(text: &str) -> Value {
        json!({ "reason": text })
    }

    #[sqlx::test]
    async fn staff_remove_and_restore_a_comment_with_a_reason(db: PgPool) {
        let author = session(&db, AUTHOR, &[]).await;
        let staff = session(&db, STAFF, &[Privilege::ManagePosts]).await;
        let (run_id, comment) = commented_run(&db, &author).await;
        let hide = format!("/v1/staff/run-comments/{comment}/hide");

        assert_eq!(
            send(&db, "POST", &hide, &staff, Some(reason(" ")))
                .await
                .status,
            422
        );
        assert_eq!(
            send(&db, "POST", &hide, &staff, Some(reason("Spam")))
                .await
                .status,
            204
        );
        assert_eq!(
            send(&db, "POST", &hide, &staff, Some(reason("Spam")))
                .await
                .status,
            404
        );

        let public: RunCommentList = test_client::get(&db, &format!("/v1/runs/{run_id}/comments"))
            .await
            .json();
        assert!(public.threads.is_empty());
        let staff_list: RunCommentList = send(
            &db,
            "GET",
            &format!("/v1/staff/runs/{run_id}/comments"),
            &staff,
            None,
        )
        .await
        .json();
        let shown = staff_list.threads[0]
            .comment
            .as_ref()
            .expect("staff see it");
        let removal = shown.removal.as_ref().expect("removed");
        assert_eq!(removal.reason.as_deref(), Some("Spam"));
        assert!(!removal.by_author);

        // The run's staff log shows it, and so does the author's.
        let log: LogEntries = send(
            &db,
            "GET",
            &format!("/v1/staff/runs/{run_id}/log"),
            &staff,
            None,
        )
        .await
        .json();
        assert_eq!(log.entries[0].action, StaffAction::HideRunComment);
        assert_eq!(log.entries[0].detail["body"], "Spam");
        let log: LogEntries = send(
            &db,
            "GET",
            &format!("/v1/staff/players/{AUTHOR}/log"),
            &staff,
            None,
        )
        .await
        .json();
        assert_eq!(log.entries[0].action, StaffAction::HideRunComment);

        let restore = format!("/v1/staff/run-comments/{comment}/restore");
        assert_eq!(
            send(&db, "POST", &restore, &staff, Some(reason("Fine")))
                .await
                .status,
            204
        );
        let public: RunCommentList = test_client::get(&db, &format!("/v1/runs/{run_id}/comments"))
            .await
            .json();
        assert_eq!(public.total, 1);
    }

    #[sqlx::test]
    async fn a_comment_its_author_removed_stays_removed(db: PgPool) {
        let author = session(&db, AUTHOR, &[]).await;
        let staff = session(&db, STAFF, &[Privilege::ManagePosts]).await;
        let (run_id, comment) = commented_run(&db, &author).await;
        let own = format!("/v1/runs/{run_id}/comments/{comment}");
        assert_eq!(send(&db, "DELETE", &own, &author, None).await.status, 204);

        let restore = format!("/v1/staff/run-comments/{comment}/restore");
        assert_eq!(
            send(&db, "POST", &restore, &staff, Some(reason("Fine")))
                .await
                .status,
            422
        );
    }

    #[sqlx::test]
    async fn staff_remove_their_own_comments_as_authors(db: PgPool) {
        let staff = session(&db, STAFF, &[Privilege::ManagePosts]).await;
        let (_, comment) = commented_run(&db, &staff).await;
        let hide = format!("/v1/staff/run-comments/{comment}/hide");
        assert_eq!(
            send(&db, "POST", &hide, &staff, Some(reason("Mine")))
                .await
                .status,
            422
        );
    }

    #[sqlx::test]
    async fn refuses_staff_without_manage_posts(db: PgPool) {
        let author = session(&db, AUTHOR, &[]).await;
        let staff = session(&db, STAFF, &[Privilege::InvalidateRuns]).await;
        let (run_id, comment) = commented_run(&db, &author).await;
        for (method, path, body) in [
            ("GET", format!("/v1/staff/runs/{run_id}/comments"), None),
            (
                "POST",
                format!("/v1/staff/run-comments/{comment}/hide"),
                Some(reason("x")),
            ),
            (
                "POST",
                format!("/v1/staff/run-comments/{comment}/restore"),
                Some(reason("x")),
            ),
        ] {
            assert_eq!(
                send(&db, method, &path, &staff, body).await.status,
                403,
                "{path}"
            );
        }
    }
}
