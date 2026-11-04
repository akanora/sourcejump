//! Published plugin builds, served at `GET /v1/plugin/latest` so servers can tell when they're out of date.

use axum::{Json, extract::State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
};

/// A published `sourcejump.smx` build.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PluginRelease {
    pub version: String,
    /// SHA-256 of the `.smx` file, hex. The plugin checks a download against it before using it.
    pub sha256: String,
    pub download_url: String,
    pub released_at: DateTime<Utc>,
}

pub fn routes() -> OpenApiRouter<AppState> {
    // Servers check for updates on every ruleset load; releases are rare.
    OpenApiRouter::new()
        .routes(routes!(latest))
        .layer(axum::middleware::from_fn(crate::etag::conditional))
}

/// The newest plugin release.
#[utoipa::path(
    get,
    path = "/v1/plugin/latest",
    tag = "plugin",
    responses(
        (status = OK, body = PluginRelease),
        (status = NOT_FOUND, description = "No release has been published yet", body = ErrorBody),
    ),
)]
async fn latest(State(state): State<AppState>) -> Result<Json<PluginRelease>, ApiError> {
    sqlx::query_as!(
        PluginRelease,
        "SELECT version, sha256, download_url, released_at FROM plugin_releases ORDER BY released_at DESC LIMIT 1"
    )
    .fetch_optional(&state.db)
    .await?
    .map(Json)
    .ok_or(ApiError::NotFound("no plugin release has been published yet"))
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use super::PluginRelease;
    use crate::test_client;

    #[sqlx::test]
    async fn serves_the_newest_release(db: PgPool) {
        sqlx::query(
            "INSERT INTO plugin_releases (version, sha256, download_url, released_at) VALUES
             ('1.0.0', repeat('a', 64), 'https://example.net/1.0.0.smx', now() - interval '1 day'),
             ('1.1.0', repeat('b', 64), 'https://example.net/1.1.0.smx', now())",
        )
        .execute(&db)
        .await
        .unwrap();

        let response = test_client::get(&db, "/v1/plugin/latest").await;

        assert_eq!(response.status, 200);
        let release: PluginRelease = response.json();
        assert_eq!(release.version, "1.1.0");
    }

    #[sqlx::test]
    async fn answers_not_found_before_any_release(db: PgPool) {
        assert_eq!(test_client::get(&db, "/v1/plugin/latest").await.status, 404);
    }
}
