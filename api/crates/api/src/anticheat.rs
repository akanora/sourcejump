//! Anti-cheat detections, `POST /v1/anticheat/detections`: keyed servers forward what BASH reports.
//!
//! Detections are not public. Like runs, each one carries an ID from the server, so a resend changes nothing.
//! No IP addresses are taken: staff review needs the player and what was detected, not where they connect from.

use axum::{Json, extract::State, http::StatusCode};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    maps::{self, MapName},
    players,
    runs::RunPlayer,
    servers::{self, keys::ServerKey},
};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DetectionReport {
    /// The ID the game server gave this detection. Unique per server; resending is safe.
    pub server_detection_id: String,
    pub player: RunPlayer,
    #[schema(value_type = String, example = "bhop_badges")]
    pub map: MapName,
    /// What the anti-cheat reported, as text.
    pub message: String,
    /// Unix seconds by the game server's clock.
    pub detected_at: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DetectionAccepted {
    pub id: i64,
}

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(report_detection))
}

/// Forward an anti-cheat detection. Same retry rules as runs: `4xx` is final, `5xx` and network errors aren't.
#[utoipa::path(
    post,
    path = "/v1/anticheat/detections",
    tag = "anticheat",
    request_body = DetectionReport,
    responses(
        (status = CREATED, description = "Stored", body = DetectionAccepted),
        (status = OK, description = "This server sent this detection before; nothing changed", body = DetectionAccepted),
        (status = UNAUTHORIZED, description = "Missing, unknown or revoked API key", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "The report breaks a rule and will never be accepted", body = ErrorBody),
    ),
    security(("server_key" = [])),
)]
async fn report_detection(
    State(state): State<AppState>,
    key: ServerKey,
    JsonBody(report): JsonBody<DetectionReport>,
) -> Result<(StatusCode, Json<DetectionAccepted>), ApiError> {
    let invalid_length = |value: &str, max: usize| value.is_empty() || value.len() > max;
    if invalid_length(&report.server_detection_id, 64)
        || invalid_length(&report.player.name, 128)
        || invalid_length(&report.message, 1024)
    {
        return Err(ApiError::Invalid(
            "server_detection_id, player.name and message must be 1 to 64, 128 and 1024 bytes"
                .into(),
        ));
    }
    let detected_at = servers::server_time("detected_at", report.detected_at, Utc::now())
        .map_err(ApiError::Invalid)?;

    let mut tx = state.db.begin().await?;
    players::record_name(
        &mut tx,
        report.player.steamid64,
        &report.player.name,
        detected_at,
    )
    .await?;
    let map_id = maps::id_for(&mut tx, &report.map).await?;
    let inserted = sqlx::query_scalar!(
        r#"
        INSERT INTO anticheat_detections
            (server_id, key_id, server_detection_id, player_steamid64, player_name, map_id, message, detected_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (server_id, server_detection_id) DO NOTHING
        RETURNING id
        "#,
        key.server_id,
        key.key_id,
        report.server_detection_id,
        report.player.steamid64.get(),
        report.player.name,
        map_id,
        report.message,
        detected_at
    )
    .fetch_optional(&mut *tx)
    .await?;
    let (status, id) = if let Some(id) = inserted {
        (StatusCode::CREATED, id)
    } else {
        let id = sqlx::query_scalar!(
            "SELECT id FROM anticheat_detections WHERE server_id = $1 AND server_detection_id = $2",
            key.server_id,
            report.server_detection_id
        )
        .fetch_one(&mut *tx)
        .await?;
        (StatusCode::OK, id)
    };
    tx.commit().await?;
    Ok((status, Json(DetectionAccepted { id })))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::DetectionAccepted;
    use crate::{servers::keys, test_client};

    #[sqlx::test]
    async fn stores_a_detection_once(db: PgPool) {
        let key = keys::issue(&db, "Test server").await.unwrap().key;
        let report = json!({
            "server_detection_id": "d1",
            "player": { "steamid64": "76561197960287930", "name": "gabe" },
            "map": "bhop_badges",
            "message": "gabe has 98% gains on 40 strafes",
            "detected_at": 1_792_400_000,
        });

        let first = test_client::post(&db, "/v1/anticheat/detections", Some(&key), &report).await;
        let again = test_client::post(&db, "/v1/anticheat/detections", Some(&key), &report).await;
        let keyless = test_client::post(&db, "/v1/anticheat/detections", None, &report).await;

        assert_eq!(first.status, 201);
        assert_eq!(again.status, 200);
        assert_eq!(
            first.json::<DetectionAccepted>().id,
            again.json::<DetectionAccepted>().id
        );
        assert_eq!(keyless.status, 401);
        let stored: i64 = sqlx::query_scalar("SELECT count(*) FROM anticheat_detections")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(stored, 1);
    }

    #[sqlx::test]
    async fn a_detection_from_the_future_is_refused_and_renames_nobody(db: PgPool) {
        let key = keys::issue(&db, "Test server").await.unwrap().key;
        let report = json!({
            "server_detection_id": "d1",
            "player": { "steamid64": "76561197960287930", "name": "not gabe" },
            "map": "bhop_badges",
            "message": "gains",
            "detected_at": chrono::Utc::now().timestamp() + 3600,
        });

        let response =
            test_client::post(&db, "/v1/anticheat/detections", Some(&key), &report).await;

        assert_eq!(response.status, 422);
        let players: i64 = sqlx::query_scalar("SELECT count(*) FROM players")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(players, 0);
    }
}
