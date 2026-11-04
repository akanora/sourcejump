//! Community posts: articles and YouTube videos by players with the `post_community` privilege, shown on the
//! Community page. Reading is public; writing is in `posts/write.rs`.

mod markdown;
mod write;
mod youtube;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

pub(crate) use write::not_banned_from_posting;

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    players::PlayerRef,
};

const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 50;
const EXCERPT_CHARS: usize = 200;

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_posts, write::create_post))
        .routes(routes!(get_post, write::update_post, write::hide_post))
}

/// What a post is. More kinds (maps, events, …) can join as the community decides.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PostKind {
    /// A written post, in Markdown.
    Article,
    /// A YouTube video, with an optional note.
    Video,
}

impl PostKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Article => "article",
            Self::Video => "video",
        }
    }

    pub(crate) fn parse(text: &str) -> Self {
        // The column's CHECK allows only these two.
        if text == "video" {
            Self::Video
        } else {
            Self::Article
        }
    }
}

/// A post as lists show it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostSummary {
    pub id: i64,
    /// The title as a URL part. Pages link to `/community/{id}-{slug}`; only the ID identifies the post.
    pub slug: String,
    pub kind: PostKind,
    pub title: String,
    /// The opening words of the body, as plain text. Empty for a video without a note.
    pub excerpt: String,
    /// For videos: where to watch it.
    pub video_url: Option<String>,
    pub author: PlayerRef,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// One post in full.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Post {
    #[serde(flatten)]
    pub summary: PostSummary,
    /// The Markdown as written, for editing.
    pub body: String,
    /// The body as HTML, safe to insert into a page: no raw HTML, scripts or images, and only web, mail and
    /// on-site links.
    pub body_html: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PostList {
    /// Newest first.
    pub posts: Vec<PostSummary>,
    /// Pass as `cursor` for older posts. None at the end.
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct PostListQuery {
    /// Only this kind. Leave out for all.
    pub kind: Option<PostKind>,
    /// 1 to 50. Default 20.
    pub limit: Option<i64>,
    /// A `next_cursor` from an earlier page.
    pub cursor: Option<String>,
}

/// How a post or run comment was removed. Staff see this on removed ones; everyone else never sees them at all.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Removal {
    pub hidden_at: DateTime<Utc>,
    /// None only if that player's record is gone.
    pub hidden_by: Option<PlayerRef>,
    /// Whether its author removed it. Then it can't be restored.
    pub by_author: bool,
    /// Why staff removed it. None when its author did.
    pub reason: Option<String>,
}

/// A post as `rows` reads it: in full, and how it was removed when it was.
pub(crate) struct PostRow {
    pub post: Post,
    pub removal: Option<Removal>,
}

/// Published posts, newest first.
#[utoipa::path(
    get,
    path = "/v1/posts",
    tag = "posts",
    params(PostListQuery),
    responses(
        (status = OK, body = PostList),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid limit or cursor", body = ErrorBody),
    ),
)]
async fn list_posts(
    State(state): State<AppState>,
    Query(query): Query<PostListQuery>,
) -> Result<Json<PostList>, ApiError> {
    let (posts, next_cursor) = page(&state.db, &query, false).await?;
    Ok(Json(PostList {
        posts: posts.into_iter().map(|row| row.post.summary).collect(),
        next_cursor,
    }))
}

/// A page of posts for `query`, newest first, and the cursor for the next. Removed posts only `with_removed`,
/// for staff, so that the staff list pages exactly like the public one.
pub(crate) async fn page(
    db: &PgPool,
    query: &PostListQuery,
    with_removed: bool,
) -> Result<(Vec<PostRow>, Option<String>), ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::Invalid(format!(
            "limit must be between 1 and {MAX_LIMIT}"
        )));
    }
    // Cursors are the last post's ID; IDs grow with time, so older posts have smaller ones.
    let before = query
        .cursor
        .as_deref()
        .map(|cursor| {
            cursor
                .parse::<i64>()
                .map_err(|_| ApiError::Invalid("that isn't a posts cursor".to_owned()))
        })
        .transpose()?;

    let filter = Filter {
        id: None,
        kind: query.kind,
        before,
        with_removed,
    };
    let mut posts = rows(db, filter, limit + 1).await?;
    let next_cursor = if posts.len() > usize::try_from(limit).expect("checked to be positive") {
        posts.pop();
        posts.last().map(|row| row.post.summary.id.to_string())
    } else {
        None
    };
    Ok((posts, next_cursor))
}

/// One published post. Takes the ID, or the `{id}-{slug}` pages link with.
#[utoipa::path(
    get,
    path = "/v1/posts/{post}",
    tag = "posts",
    params(("post" = String, Path, description = "The post's ID, optionally followed by `-` and its slug")),
    responses(
        (status = OK, body = Post),
        (status = NOT_FOUND, description = "No such post, or it was removed", body = ErrorBody),
    ),
)]
async fn get_post(
    State(state): State<AppState>,
    Path(post): Path<String>,
) -> Result<Json<Post>, ApiError> {
    let id = post_id(&post)?;
    find(&state.db, id).await?.map(Json).ok_or(NOT_FOUND)
}

pub(crate) const NOT_FOUND: ApiError = ApiError::NotFound("SourceJump has no such post");

/// The ID at the start of `12` or `12-new-map-release`.
pub(crate) fn post_id(text: &str) -> Result<i64, ApiError> {
    let digits = text.split('-').next().unwrap_or_default();
    digits.parse().map_err(|_| NOT_FOUND)
}

/// A published post by ID.
async fn find(db: &PgPool, id: i64) -> Result<Option<Post>, sqlx::Error> {
    let filter = Filter {
        id: Some(id),
        ..Filter::default()
    };
    Ok(rows(db, filter, 1).await?.pop().map(|row| row.post))
}

/// Which posts `rows` reads. All `None` and false: every published post.
#[derive(Default)]
pub(crate) struct Filter {
    pub id: Option<i64>,
    pub kind: Option<PostKind>,
    /// Only posts with a smaller ID: older ones.
    pub before: Option<i64>,
    /// Removed posts too, for staff.
    pub with_removed: bool,
}

/// Posts newest first: one by `id`, or a page of `kind` before a cursor.
pub(crate) async fn rows(
    db: &PgPool,
    filter: Filter,
    limit: i64,
) -> Result<Vec<PostRow>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT p.id, p.kind, p.title, p.body, p.video_id, p.created_at, p.updated_at,
               a.steamid64::text AS "steamid64!", a.name, a.avatar_url, a.country_code,
               p.hidden_at, p.hidden_by IS NOT DISTINCT FROM p.author_steamid64 AS "by_author!",
               h.steamid64::text AS "by_steamid64?", h.name AS "by_name?",
               h.avatar_url AS by_avatar_url, h.country_code AS by_country_code,
               l.reason AS "reason?"
        FROM posts p
        JOIN players a ON a.steamid64 = p.author_steamid64
        LEFT JOIN players h ON h.steamid64 = p.hidden_by
        LEFT JOIN staff_log l ON l.id = p.hidden_log_id
        WHERE ($5 OR p.hidden_at IS NULL)
          AND ($1::bigint IS NULL OR p.id = $1)
          AND ($2::text IS NULL OR p.kind = $2)
          AND ($3::bigint IS NULL OR p.id < $3)
        ORDER BY p.id DESC
        LIMIT $4
        "#,
        filter.id,
        filter.kind.map(PostKind::as_str),
        filter.before,
        limit,
        filter.with_removed
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| PostRow {
            removal: row.hidden_at.map(|hidden_at| Removal {
                hidden_at,
                hidden_by: row
                    .by_steamid64
                    .zip(row.by_name)
                    .map(|(steamid64, name)| PlayerRef {
                        steamid64,
                        name,
                        avatar_url: row.by_avatar_url,
                        country_code: row.by_country_code,
                    }),
                by_author: row.by_author,
                reason: row.reason,
            }),
            post: Post {
                summary: PostSummary {
                    id: row.id,
                    slug: slug(&row.title),
                    kind: PostKind::parse(&row.kind),
                    excerpt: markdown::excerpt(&row.body, EXCERPT_CHARS),
                    title: row.title,
                    video_url: row.video_id.as_deref().map(youtube::watch_url),
                    author: PlayerRef {
                        steamid64: row.steamid64,
                        name: row.name,
                        avatar_url: row.avatar_url,
                        country_code: row.country_code,
                    },
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                },
                body_html: markdown::to_html(&row.body),
                body: row.body,
            },
        })
        .collect())
}

/// A title as a URL part: lowercase letters and digits joined by `-`, at most 60 characters.
fn slug(title: &str) -> String {
    let words: Vec<String> = title
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_ascii_lowercase)
        .collect();
    let mut slug = String::new();
    for word in words {
        if slug.len() + word.len() + 1 > 60 {
            break;
        }
        if !slug.is_empty() {
            slug.push('-');
        }
        slug.push_str(&word);
    }
    if slug.is_empty() {
        "post".to_owned()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_short_lowercase_words() {
        assert_eq!(slug("New map: bhop_eazy v2!"), "new-map-bhop-eazy-v2");
        assert_eq!(slug("Ünïcode ☃"), "n-code");
        assert_eq!(slug("☃"), "post");
        assert!(slug(&"word ".repeat(40)).len() <= 60);
    }

    #[test]
    fn post_ids_come_first() {
        assert_eq!(post_id("12-new-map").ok(), Some(12));
        assert_eq!(post_id("12").ok(), Some(12));
        assert!(post_id("new-map").is_err());
    }
}
