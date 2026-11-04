//! `GET /v1/replays/{run_id}`: the run's replay as the shavit file it was uploaded as, for players and for
//! servers that play replays in-game. Rebuilt from SJR, which is a quarter of the size to keep.

use axum::{
    body::Body,
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, types::Json as JsonColumn};
use utoipa::ToSchema;

use super::{current_policy, sjr};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
};

/// A run's stored replay, as the run's page shows it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RunReplay {
    /// The replay in SJR form, for the web viewer. The shavit file is at `/v1/replays/{run_id}`.
    pub sjr_url: String,
    /// The shavit file's size in bytes.
    pub size: i32,
    /// The route seen from above, start to finish: up to 200 `[x, y]` points in Source units (y points north).
    /// None for replays stored before routes were kept.
    pub route: Option<Vec<[i32; 2]>>,
}

/// A shavit replay file, for the OpenAPI spec: binary, not JSON.
#[derive(ToSchema)]
#[schema(value_type = String, format = Binary)]
#[expect(dead_code, reason = "never built; it only describes the response body")]
pub struct ReplayFile(Vec<u8>);

pub struct PublicReplay {
    pub stored_key: String,
    /// The shavit file's size in bytes.
    pub size: i32,
    /// Names the downloaded file. Map names are limited to `[a-z0-9_.-]`, so they're safe in a header.
    pub map: String,
    pub route: Option<Vec<[i32; 2]>>,
    /// Staff took the run off the boards. Its replay can still be watched on the site, so anyone can see why,
    /// but the file isn't handed out, so a cheated replay isn't spread from SourceJump (lead, 2026-11-03).
    pub invalidated: bool,
}

/// The run's replay if it's stored and its style's replays are public.
pub async fn public_replay(
    conn: &mut PgConnection,
    run_id: i64,
) -> Result<Option<PublicReplay>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT p.stored_key AS "stored_key!", p.raw_bytes AS "size!", r.style, m.name AS map,
               p.route AS "route: JsonColumn<Vec<[i32; 2]>>", r.invalidated_at IS NOT NULL AS "invalidated!"
        FROM replays p JOIN runs r ON r.id = p.run_id JOIN maps m ON m.id = r.map_id
        WHERE p.run_id = $1 AND p.stored_key IS NOT NULL
        "#,
        run_id
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else { return Ok(None) };
    if !current_policy(conn).await?.is_public(&row.style) {
        return Ok(None);
    }
    Ok(Some(PublicReplay {
        stored_key: row.stored_key,
        size: row.size,
        map: row.map,
        route: row.route.map(|route| route.0),
        invalidated: row.invalidated,
    }))
}

/// Download a run's replay, in shavit's replay format 12.
#[utoipa::path(
    get,
    path = "/v1/replays/{run_id}",
    tag = "replays",
    params(("run_id" = i64, Path, description = "SourceJump's run ID")),
    responses(
        (status = OK, description = "The shavit replay file", content_type = "application/octet-stream", body = ReplayFile),
        (status = NOT_FOUND, description = "No replay is stored for this run, it isn't public, or the run was invalidated", body = ErrorBody),
    ),
)]
pub async fn download_replay(
    State(state): State<AppState>,
    Path(run_id): Path<i64>,
) -> Result<Response, ApiError> {
    let Some(PublicReplay {
        stored_key,
        map,
        invalidated: false,
        ..
    }) = public_replay(&mut *state.db.acquire().await?, run_id).await?
    else {
        return Err(ApiError::NotFound("no public replay for this run"));
    };
    let stored = state
        .storage
        .get(&stored_key)
        .await
        .map_err(|error| ApiError::Internal(error.into()))?;
    let file = sjr::decode(&stored).map_err(|error| {
        ApiError::Internal(format!("stored replay {stored_key} is damaged: {error}").into())
    })?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{map}-{run_id}.replay\""),
            ),
            // Short, so a run staff invalidate stops being served from caches within the hour.
            (header::CACHE_CONTROL, "public, max-age=3600".to_owned()),
        ],
        Body::from(file),
    )
        .into_response())
}
