//! Writing community posts: create, edit, and authors removing their own.
//!
//! Sensitive path, fails closed. Every write needs a session, our own `Origin`, and a privilege:
//! `post_community` to post and to change one's own posts, `manage_posts` to change anyone's. Removing hides
//! the post and keeps it in the database, so a mistake or abuse can be looked into. Staff editing someone
//! else's post give a reason and the edit is logged here; staff remove other players' posts with a reason,
//! logged, in `staff/posts.rs`.

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::ToSchema;

use super::{NOT_FOUND, Post, PostKind, find, post_id, youtube};
use crate::{
    app::AppState,
    auth::sessions::{SignedIn, require_same_origin},
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    players::{
        privileges::Privilege,
        restrictions::{self, Restriction},
    },
    staff::log::{self, StaffAction, check_reason},
};

const MAX_TITLE_CHARS: usize = 120;
const MAX_BODY_CHARS: usize = 20_000;

/// A post as its author writes it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostInput {
    pub kind: PostKind,
    /// 1 to 120 characters.
    pub title: String,
    /// Markdown, up to 20,000 characters. Required for an article; an optional note for a video.
    #[serde(default)]
    pub body: String,
    /// For a video: a YouTube link in any common form. Not allowed on an article.
    pub video_url: Option<String>,
    /// Staff editing someone else's post: why, for staff only, 1 to 500 characters. Ignored otherwise.
    pub reason: Option<String>,
}

/// The post's fields, checked.
struct Checked {
    kind: PostKind,
    title: String,
    body: String,
    video_id: Option<String>,
}

fn check(input: &PostInput) -> Result<Checked, ApiError> {
    let invalid = |message: &str| Err(ApiError::Invalid(message.to_owned()));
    let title = input.title.trim().to_owned();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return invalid("a title is 1 to 120 characters");
    }
    let body = input.body.trim().to_owned();
    if body.chars().count() > MAX_BODY_CHARS {
        return invalid("a post's text is at most 20,000 characters");
    }
    let link = input
        .video_url
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty());
    let video_id =
        match (input.kind, link) {
            (PostKind::Article, None) if body.is_empty() => {
                return invalid("an article needs some text");
            }
            (PostKind::Article, None) => None,
            (PostKind::Article, Some(_)) => return invalid("only video posts have a video link"),
            (PostKind::Video, None) => return invalid("a video post needs a YouTube link"),
            (PostKind::Video, Some(link)) => Some(youtube::video_id(link).ok_or_else(|| {
                ApiError::Invalid("that isn't a link to a YouTube video".to_owned())
            })?),
        };
    Ok(Checked {
        kind: input.kind,
        title,
        body,
        video_id,
    })
}

/// Publish a post. Needs the `post_community` privilege (or `manage_posts`).
#[utoipa::path(
    post,
    path = "/v1/posts",
    tag = "posts",
    request_body = PostInput,
    responses(
        (status = CREATED, body = Post),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Not allowed to post, or not from SourceJump's pages", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid post", body = ErrorBody),
    ),
)]
pub async fn create_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    me: SignedIn,
    JsonBody(input): JsonBody<PostInput>,
) -> Result<(StatusCode, Json<Post>), ApiError> {
    require_same_origin(&headers, &state.public_url)?;
    not_banned_from_posting(&state, me).await?;
    if !me.privileges.contains(Privilege::PostCommunity)
        && !me.privileges.contains(Privilege::ManagePosts)
    {
        return Err(ApiError::Forbidden(
            "posting needs the post_community privilege",
        ));
    }
    let post = check(&input)?;
    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO posts (kind, title, body, video_id, author_steamid64)
        VALUES ($1, $2, $3, $4, $5) RETURNING id
        "#,
        post.kind.as_str(),
        post.title,
        post.body,
        post.video_id,
        me.steamid64.get()
    )
    .fetch_one(&state.db)
    .await?;
    let created = find(&state.db, id).await?.ok_or(NOT_FOUND)?;
    Ok((StatusCode::CREATED, Json(created)))
}

/// Change a post. Its author may, with `post_community`; anyone with `manage_posts` may, giving a reason
/// for someone else's post. Such an edit is in the staff log, unless it changes nothing.
#[utoipa::path(
    put,
    path = "/v1/posts/{post}",
    tag = "posts",
    params(("post" = String, Path, description = "The post's ID")),
    request_body = PostInput,
    responses(
        (status = OK, body = Post),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Not allowed to change this post", body = ErrorBody),
        (status = NOT_FOUND, description = "No such post, or it was removed", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid post, or staff gave no reason", body = ErrorBody),
    ),
)]
pub async fn update_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    me: SignedIn,
    Path(post): Path<String>,
    JsonBody(input): JsonBody<PostInput>,
) -> Result<Json<Post>, ApiError> {
    require_same_origin(&headers, &state.public_url)?;
    let id = post_id(&post)?;
    may_change(&state, me, id).await?;
    let post = check(&input)?;
    let mut tx = state.db.begin().await?;
    let before = sqlx::query!(
        "SELECT p.kind, p.title, p.body, p.video_id, p.author_steamid64, a.name AS author_name
         FROM posts p JOIN players a ON a.steamid64 = p.author_steamid64
         WHERE p.id = $1 AND p.hidden_at IS NULL FOR UPDATE OF p",
        id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(NOT_FOUND)?;
    let changed: Vec<&str> = [
        ("kind", before.kind != post.kind.as_str()),
        ("title", before.title != post.title),
        ("body", before.body != post.body),
        ("video", before.video_id != post.video_id),
    ]
    .into_iter()
    .filter_map(|(field, differs)| differs.then_some(field))
    .collect();

    if before.author_steamid64 != me.steamid64.get() {
        // `may_change` let this through on `manage_posts`: a staff edit, which needs a reason and is logged.
        let reason = check_reason(input.reason.as_deref().unwrap_or_default())?;
        if changed.is_empty() {
            return Ok(Json(find(&state.db, id).await?.ok_or(NOT_FOUND)?));
        }
        let entry = log::Entry {
            actor: Some(me.steamid64),
            action: StaffAction::EditPost,
            target: &id.to_string(),
            reason: Some(&reason),
            detail: json!({
                "title": post.title,
                "previous_title": before.title,
                "author": before.author_steamid64.to_string(),
                "author_name": before.author_name,
                "changed": changed,
            }),
        };
        log::record(&mut tx, entry).await?;
    }
    sqlx::query!(
        "UPDATE posts SET kind = $2, title = $3, body = $4, video_id = $5, updated_at = now() WHERE id = $1",
        id,
        post.kind.as_str(),
        post.title,
        post.body,
        post.video_id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(find(&state.db, id).await?.ok_or(NOT_FOUND)?))
}

/// Remove your own post from the site. It stays in the database. Staff remove other players' posts with
/// `POST /v1/staff/posts/{id}/hide`, which asks for a reason.
#[utoipa::path(
    delete,
    path = "/v1/posts/{post}",
    tag = "posts",
    params(("post" = String, Path, description = "The post's ID")),
    responses(
        (status = NO_CONTENT, description = "Removed"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Not your post, or not allowed to post", body = ErrorBody),
        (status = NOT_FOUND, description = "No such post, or it was removed already", body = ErrorBody),
    ),
)]
pub async fn hide_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    me: SignedIn,
    Path(post): Path<String>,
) -> Result<StatusCode, ApiError> {
    require_same_origin(&headers, &state.public_url)?;
    let id = post_id(&post)?;
    may_change(&state, me, id).await?;
    let own = sqlx::query_scalar!(
        "SELECT author_steamid64 = $2 AS \"own!\" FROM posts WHERE id = $1",
        id,
        me.steamid64.get()
    )
    .fetch_one(&state.db)
    .await?;
    if !own {
        return Err(ApiError::Forbidden(
            "staff remove other players' posts from the staff tools, with a reason",
        ));
    }
    sqlx::query!(
        "UPDATE posts SET hidden_at = now(), hidden_by = $2 WHERE id = $1 AND hidden_at IS NULL",
        id,
        me.steamid64.get()
    )
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Refuses a player whose active ban includes `no_posting`, for posts and run comments alike. What they
/// already posted stays up (lead, 2026-10-20).
pub(crate) async fn not_banned_from_posting(
    state: &AppState,
    me: SignedIn,
) -> Result<(), ApiError> {
    let active = restrictions::active(&mut *state.db.acquire().await?, me.steamid64).await?;
    if active.contains(Restriction::NoPosting) {
        Err(ApiError::Forbidden("you're banned from posting"))
    } else {
        Ok(())
    }
}

/// Staff with `manage_posts` may change any shown post; authors theirs, while they hold `post_community`.
/// Nobody banned from posting may.
async fn may_change(state: &AppState, me: SignedIn, id: i64) -> Result<(), ApiError> {
    not_banned_from_posting(state, me).await?;
    let author = sqlx::query_scalar!(
        "SELECT author_steamid64 FROM posts WHERE id = $1 AND hidden_at IS NULL",
        id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or(NOT_FOUND)?;
    let own = author == me.steamid64.get() && me.privileges.contains(Privilege::PostCommunity);
    if own || me.privileges.contains(Privilege::ManagePosts) {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "only its author or staff can change this post",
        ))
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use crate::{
        auth::sessions,
        players::{
            SteamId64,
            privileges::{self, Privilege, Privileges},
        },
        posts::{Post, PostList},
        test_client::{self, TestResponse},
    };

    const AUTHOR: &str = "76561197960287930";
    const OTHER: &str = "76561197960287931";
    const STAFF: &str = "76561197960287932";

    /// A session for a player holding `held`.
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
        token: Option<&str>,
        body: Option<&Value>,
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

    fn article() -> Value {
        json!({ "kind": "article", "title": "New maps this week", "body": "Three **new** maps." })
    }

    #[sqlx::test]
    async fn authors_post_edit_and_remove_their_own(db: PgPool) {
        let author = session(&db, AUTHOR, &[Privilege::PostCommunity]).await;

        let created = send(&db, "POST", "/v1/posts", Some(&author), Some(&article())).await;
        assert_eq!(created.status, 201);
        let post: Post = created.json();
        assert_eq!(post.summary.slug, "new-maps-this-week");
        assert_eq!(post.body_html, "<p>Three <strong>new</strong> maps.</p>\n");

        let video = json!({
            "kind": "video", "title": "WR run", "video_url": "https://youtu.be/dQw4w9WgXcQ?si=x"
        });
        let path = format!("/v1/posts/{}-new-maps-this-week", post.summary.id);
        let edited: Post = send(&db, "PUT", &path, Some(&author), Some(&video))
            .await
            .json();
        assert_eq!(
            edited.summary.video_url.as_deref(),
            Some("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        );

        let list: PostList = test_client::get(&db, "/v1/posts?kind=video").await.json();
        assert_eq!(list.posts.len(), 1);
        assert_eq!(
            send(&db, "DELETE", &path, Some(&author), None).await.status,
            204
        );
        assert_eq!(test_client::get(&db, &path).await.status, 404);
    }

    #[sqlx::test]
    async fn only_authors_and_staff_may_change_a_post(db: PgPool) {
        let author = session(&db, AUTHOR, &[Privilege::PostCommunity]).await;
        let other = session(&db, OTHER, &[Privilege::PostCommunity]).await;
        let staff = session(&db, STAFF, &[Privilege::ManagePosts]).await;
        let plain = session(&db, "76561197960287933", &[]).await;

        assert_eq!(
            send(&db, "POST", "/v1/posts", None, Some(&article()))
                .await
                .status,
            401
        );
        assert_eq!(
            send(&db, "POST", "/v1/posts", Some(&plain), Some(&article()))
                .await
                .status,
            403
        );
        let post: Post = send(&db, "POST", "/v1/posts", Some(&author), Some(&article()))
            .await
            .json();
        let path = format!("/v1/posts/{}", post.summary.id);

        assert_eq!(
            send(&db, "PUT", &path, Some(&other), Some(&article()))
                .await
                .status,
            403
        );
        assert_eq!(
            send(&db, "DELETE", &path, Some(&other), None).await.status,
            403
        );
        // Staff edit someone else's post with a reason, which the staff log keeps.
        assert_eq!(
            send(&db, "PUT", &path, Some(&staff), Some(&article()))
                .await
                .status,
            422
        );
        let mut edit = article();
        edit["title"] = json!("Moderated title");
        edit["reason"] = json!("Misleading title");
        assert_eq!(
            send(&db, "PUT", &path, Some(&staff), Some(&edit))
                .await
                .status,
            200
        );
        let logged = sqlx::query!("SELECT action, reason, detail FROM staff_log")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(
            (logged.action.as_str(), logged.reason.as_deref()),
            ("edit_post", Some("Misleading title"))
        );
        assert_eq!(logged.detail["changed"], json!(["title"]));
        // Saving it unchanged logs nothing more; the author's own edits are never logged.
        send(&db, "PUT", &path, Some(&staff), Some(&edit)).await;
        send(&db, "PUT", &path, Some(&author), Some(&article())).await;
        assert_eq!(
            sqlx::query_scalar!("SELECT count(*) FROM staff_log")
                .fetch_one(&db)
                .await
                .unwrap(),
            Some(1)
        );
        // Staff remove someone else's post with a reason, in the staff tools.
        assert_eq!(
            send(&db, "DELETE", &path, Some(&staff), None).await.status,
            403
        );
        assert_eq!(
            send(&db, "DELETE", &path, Some(&author), None).await.status,
            204
        );
        assert_eq!(
            send(&db, "DELETE", &path, Some(&author), None).await.status,
            404
        );

        // An author who loses the privilege can't change their posts any more.
        let post: Post = send(&db, "POST", "/v1/posts", Some(&author), Some(&article()))
            .await
            .json();
        let steamid64 = SteamId64::parse_any(AUTHOR).unwrap();
        privileges::revoke(&db, steamid64, Privileges::of(&[Privilege::PostCommunity]))
            .await
            .unwrap();
        let path = format!("/v1/posts/{}", post.summary.id);
        assert_eq!(
            send(&db, "DELETE", &path, Some(&author), None).await.status,
            403
        );
    }

    #[sqlx::test]
    async fn writes_need_our_origin_and_a_valid_post(db: PgPool) {
        let author = session(&db, AUTHOR, &[Privilege::PostCommunity]).await;
        let request = Request::post("/v1/posts")
            .header("origin", "https://evil.example")
            .header("content-type", "application/json")
            .header("cookie", format!("{}={author}", sessions::COOKIE))
            .body(Body::from(article().to_string()))
            .unwrap();
        assert_eq!(test_client::send(&db, request).await.status, 403);

        for bad in [
            json!({ "kind": "article", "title": "", "body": "text" }),
            json!({ "kind": "article", "title": "No text", "body": "  " }),
            json!({ "kind": "article", "title": "Link", "body": "x", "video_url": "https://youtu.be/dQw4w9WgXcQ" }),
            json!({ "kind": "video", "title": "No link" }),
            json!({ "kind": "video", "title": "Vimeo", "video_url": "https://vimeo.com/1" }),
        ] {
            let response = send(&db, "POST", "/v1/posts", Some(&author), Some(&bad)).await;
            assert_eq!(response.status, 422, "{bad}");
        }
    }
}
