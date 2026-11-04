//! Liveness endpoint used by the deploy script and uptime checks.

use utoipa_axum::{router::OpenApiRouter, routes};

use crate::app::AppState;

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(health))
}

/// Answers `ok` while the server is running.
#[utoipa::path(get, path = "/health", tag = "health", responses((status = OK, body = String)))]
async fn health() -> &'static str {
    "ok"
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use crate::test_client;

    #[sqlx::test]
    async fn health_answers_ok(db: PgPool) {
        let response = test_client::get(&db, "/health").await;

        assert_eq!(response.status, 200);
        assert_eq!(&response.body[..], b"ok");
    }
}
