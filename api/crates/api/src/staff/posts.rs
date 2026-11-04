//! Staff tools for community posts (`manage_posts`): the Community page and post pages with removed posts in
//! place, removing someone else's post with a reason, and restoring one staff removed.
//!
//! A post its author removed stays removed: staff can't bring it back (lead, 2026-10-20). So a removal by
//! staff is one whose `hidden_by` isn't the author; it links its staff log entry in `posts.hidden_log_id`.
//! Nobody restores their own post. Staff remove their own posts from the post's page, like any author.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use utoipa::ToSchema;

use super::{
    ChangeError,
    access::Staff,
    log::{self, StaffAction, check_reason},
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    players::{SteamId64, privileges::Privilege},
    posts::{self, Post, PostListQuery, PostSummary, Removal, post_id},
};

/// Removes someone else's post from the site and logs it with the reason.
pub async fn hide(db: &PgPool, actor: SteamId64, id: i64, reason: &str) -> Result<(), ChangeError> {
    let mut tx = db.begin().await?;
    let post = sqlx::query!(
        "SELECT p.title, p.author_steamid64, a.name AS author_name
         FROM posts p JOIN players a ON a.steamid64 = p.author_steamid64
         WHERE p.id = $1 AND p.hidden_at IS NULL FOR UPDATE OF p",
        id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ChangeError::NotFound(
        "there's no such post, or it was removed already",
    ))?;
    if post.author_steamid64 == actor.get() {
        return Err(ChangeError::Invalid(
            "remove your own posts from the post's page".to_owned(),
        ));
    }
    let entry = log::Entry {
        actor: Some(actor),
        action: StaffAction::HidePost,
        target: &id.to_string(),
        reason: Some(reason),
        detail: json!({
            "title": post.title,
            "author": post.author_steamid64.to_string(),
            "author_name": post.author_name,
        }),
    };
    let log_id = log::record(&mut tx, entry).await?;
    sqlx::query!(
        "UPDATE posts SET hidden_at = now(), hidden_by = $2, hidden_log_id = $3 WHERE id = $1",
        id,
        actor.get(),
        log_id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Puts a post staff removed back on the site and logs it.
pub async fn restore(
    db: &PgPool,
    actor: SteamId64,
    id: i64,
    reason: &str,
) -> Result<(), ChangeError> {
    let mut tx = db.begin().await?;
    let post = sqlx::query!(
        r#"SELECT p.title, p.author_steamid64, a.name AS author_name,
                  p.hidden_by IS NOT DISTINCT FROM p.author_steamid64 AS "by_author!"
           FROM posts p JOIN players a ON a.steamid64 = p.author_steamid64
           WHERE p.id = $1 AND p.hidden_at IS NOT NULL FOR UPDATE OF p"#,
        id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ChangeError::NotFound("there's no such removed post"))?;
    if post.by_author {
        return Err(ChangeError::Invalid(
            "its author removed it, so it stays removed".to_owned(),
        ));
    }
    if post.author_steamid64 == actor.get() {
        return Err(ChangeError::Invalid(
            "you can't restore your own post".to_owned(),
        ));
    }
    let entry = log::Entry {
        actor: Some(actor),
        action: StaffAction::RestorePost,
        target: &id.to_string(),
        reason: Some(reason),
        detail: json!({
            "title": post.title,
            "author": post.author_steamid64.to_string(),
            "author_name": post.author_name,
        }),
    };
    log::record(&mut tx, entry).await?;
    sqlx::query!(
        "UPDATE posts SET hidden_at = NULL, hidden_by = NULL, hidden_log_id = NULL WHERE id = $1",
        id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// A post in a list as staff see it: removed ones included, saying how they were removed.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffPostSummary {
    #[serde(flatten)]
    pub summary: PostSummary,
    /// Present when it's removed.
    pub removal: Option<Removal>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffPostList {
    /// Newest first, as `GET /v1/posts` pages them, removed posts in their place.
    pub posts: Vec<StaffPostSummary>,
    /// Pass as `cursor` for older posts. None at the end.
    pub next_cursor: Option<String>,
}

/// One post in full as staff see it, removed or not.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffPost {
    #[serde(flatten)]
    pub post: Post,
    /// Present when it's removed.
    pub removal: Option<Removal>,
}

/// Community posts as the Community page lists them, with removed posts in their place. Staff see these
/// there instead of the public list.
#[utoipa::path(
    get,
    path = "/v1/staff/posts",
    tag = "staff",
    params(PostListQuery),
    responses(
        (status = OK, body = StaffPostList),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_posts", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid limit or cursor", body = ErrorBody),
    ),
)]
pub async fn list_staff_posts(
    State(state): State<AppState>,
    staff: Staff,
    Query(query): Query<PostListQuery>,
) -> Result<Json<StaffPostList>, ApiError> {
    staff.require(Privilege::ManagePosts)?;
    let (posts, next_cursor) = posts::page(&state.db, &query, true).await?;
    Ok(Json(StaffPostList {
        posts: posts
            .into_iter()
            .map(|row| StaffPostSummary {
                summary: row.post.summary,
                removal: row.removal,
            })
            .collect(),
        next_cursor,
    }))
}

/// One post, removed or not, so staff can read a removed post on its own page.
#[utoipa::path(
    get,
    path = "/v1/staff/posts/{id}",
    tag = "staff",
    params(("id" = String, Path, description = "The post's ID, optionally followed by `-` and its slug")),
    responses(
        (status = OK, body = StaffPost),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_posts", body = ErrorBody),
        (status = NOT_FOUND, description = "No such post", body = ErrorBody),
    ),
)]
pub async fn get_staff_post(
    State(state): State<AppState>,
    staff: Staff,
    Path(post): Path<String>,
) -> Result<Json<StaffPost>, ApiError> {
    staff.require(Privilege::ManagePosts)?;
    let filter = posts::Filter {
        id: Some(post_id(&post)?),
        with_removed: true,
        ..posts::Filter::default()
    };
    let row = posts::rows(&state.db, filter, 1)
        .await?
        .pop()
        .ok_or(posts::NOT_FOUND)?;
    Ok(Json(StaffPost {
        post: row.post,
        removal: row.removal,
    }))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostReason {
    /// Why, for staff only. 1 to 500 characters.
    pub reason: String,
}

/// Remove another player's post from the site. It stays in the database and can be restored.
#[utoipa::path(
    post,
    path = "/v1/staff/posts/{id}/hide",
    tag = "staff",
    params(("id" = String, Path, description = "The post's ID")),
    request_body = PostReason,
    responses(
        (status = NO_CONTENT, description = "Removed"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_posts, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such post, or it was removed already", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Your own post, or no reason", body = ErrorBody),
    ),
)]
pub async fn post_hide_post(
    State(state): State<AppState>,
    staff: Staff,
    Path(post): Path<String>,
    JsonBody(request): JsonBody<PostReason>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManagePosts)?;
    let id = post_id(&post)?;
    let reason = check_reason(&request.reason)?;
    hide(&state.db, staff.steamid64, id, &reason).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Put a post staff removed back on the site.
#[utoipa::path(
    post,
    path = "/v1/staff/posts/{id}/restore",
    tag = "staff",
    params(("id" = String, Path, description = "The post's ID")),
    request_body = PostReason,
    responses(
        (status = NO_CONTENT, description = "Restored"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_posts, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such removed post", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Removed by its author, your own, or no reason", body = ErrorBody),
    ),
)]
pub async fn post_restore_post(
    State(state): State<AppState>,
    staff: Staff,
    Path(post): Path<String>,
    JsonBody(request): JsonBody<PostReason>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManagePosts)?;
    let id = post_id(&post)?;
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
        test_client::{self, TestResponse},
    };

    const STAFF: &str = "76561197960287920";
    const AUTHOR: &str = "76561197960287930";

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

    /// Posts an article as `token`'s player; returns its ID.
    async fn post(db: &PgPool, token: &str, title: &str) -> i64 {
        let article = json!({ "kind": "article", "title": title, "body": "Text." });
        let created = send(db, "POST", "/v1/posts", token, Some(article)).await;
        assert_eq!(created.status, 201);
        created.json::<Value>()["id"].as_i64().unwrap()
    }

    fn reason(text: &str) -> Value {
        json!({ "reason": text })
    }

    #[sqlx::test]
    async fn staff_remove_and_restore_a_post_with_reasons(db: PgPool) {
        let staff = session(&db, STAFF, &[Privilege::ManagePosts]).await;
        let author = session(&db, AUTHOR, &[Privilege::PostCommunity]).await;
        let id = post(&db, &author, "Spam").await;
        let public = format!("/v1/posts/{id}");

        let path = format!("/v1/staff/posts/{id}/hide");
        assert_eq!(
            send(&db, "POST", &path, &staff, Some(reason(" ")))
                .await
                .status,
            422
        );
        assert_eq!(
            send(&db, "POST", &path, &staff, Some(reason("Spam link")))
                .await
                .status,
            204
        );
        assert_eq!(test_client::get(&db, &public).await.status, 404);
        assert_eq!(
            send(&db, "POST", &path, &staff, Some(reason("Again")))
                .await
                .status,
            404
        );

        let list: StaffPostList = send(&db, "GET", "/v1/staff/posts", &staff, None)
            .await
            .json();
        let hidden = list.posts[0].removal.as_ref().unwrap();
        assert_eq!(
            (hidden.by_author, hidden.reason.as_deref()),
            (false, Some("Spam link"))
        );
        assert_eq!(hidden.hidden_by.as_ref().unwrap().steamid64, STAFF);
        // Its page still opens for staff, saying it's removed.
        let page: StaffPost = send(&db, "GET", &format!("/v1/staff/posts/{id}"), &staff, None)
            .await
            .json();
        assert!(page.removal.is_some());

        let restore = format!("/v1/staff/posts/{id}/restore");
        assert_eq!(
            send(
                &db,
                "POST",
                &restore,
                &staff,
                Some(reason("Not spam after all"))
            )
            .await
            .status,
            204
        );
        assert_eq!(test_client::get(&db, &public).await.status, 200);
        assert_eq!(
            send(&db, "POST", &restore, &staff, Some(reason("Twice")))
                .await
                .status,
            404
        );
        let actions: Vec<String> = sqlx::query_scalar!("SELECT action FROM staff_log ORDER BY id")
            .fetch_all(&db)
            .await
            .unwrap();
        assert_eq!(actions, ["hide_post", "restore_post"]);
    }

    #[sqlx::test]
    async fn an_authors_removal_and_ones_own_posts_stay_theirs(db: PgPool) {
        let staff = session(
            &db,
            STAFF,
            &[Privilege::ManagePosts, Privilege::PostCommunity],
        )
        .await;
        let author = session(&db, AUTHOR, &[Privilege::PostCommunity]).await;

        // Removed by its author: listed, but staff can't restore it.
        let id = post(&db, &author, "Changed my mind").await;
        let removed = send(&db, "DELETE", &format!("/v1/posts/{id}"), &author, None).await;
        assert_eq!(removed.status, 204);
        let list: StaffPostList = send(&db, "GET", "/v1/staff/posts", &staff, None)
            .await
            .json();
        let removal = list.posts[0].removal.as_ref().unwrap();
        assert!(removal.by_author && removal.reason.is_none());
        let restore = format!("/v1/staff/posts/{id}/restore");
        assert_eq!(
            send(&db, "POST", &restore, &staff, Some(reason("Bring it back")))
                .await
                .status,
            422
        );

        // Staff remove their own posts as authors, and don't restore their own.
        let own = post(&db, &staff, "Mine").await;
        let hide = format!("/v1/staff/posts/{own}/hide");
        assert_eq!(
            send(&db, "POST", &hide, &staff, Some(reason("Mine")))
                .await
                .status,
            422
        );
        let other = session(&db, "76561197960287940", &[Privilege::ManagePosts]).await;
        assert_eq!(
            send(&db, "POST", &hide, &other, Some(reason("Off topic")))
                .await
                .status,
            204
        );
        let restore = format!("/v1/staff/posts/{own}/restore");
        assert_eq!(
            send(&db, "POST", &restore, &staff, Some(reason("Mine")))
                .await
                .status,
            422
        );
        assert_eq!(
            sqlx::query_scalar!("SELECT count(*) FROM staff_log")
                .fetch_one(&db)
                .await
                .unwrap(),
            Some(1)
        );
    }

    #[sqlx::test]
    async fn every_route_needs_its_privilege(db: PgPool) {
        let others: Vec<Privilege> = Privilege::ALL
            .into_iter()
            .filter(|&p| p.is_staff() && p != Privilege::ManagePosts)
            .collect();
        let token = session(&db, STAFF, &others).await;
        let author = session(&db, AUTHOR, &[Privilege::PostCommunity]).await;
        let id = post(&db, &author, "Post").await;
        for (method, path, body) in [
            ("GET", "/v1/staff/posts".to_owned(), None),
            ("GET", format!("/v1/staff/posts/{id}"), None),
            (
                "POST",
                format!("/v1/staff/posts/{id}/hide"),
                Some(reason("Because")),
            ),
            (
                "POST",
                format!("/v1/staff/posts/{id}/restore"),
                Some(reason("Because")),
            ),
        ] {
            let response = send(&db, method, &path, &token, body).await;
            assert_eq!(response.status, 403, "{method} {path}");
        }
    }
}
