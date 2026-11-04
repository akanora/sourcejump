//! Staff reading anti-cheat detections (`review_anticheat`): one player's, for their Manage view, newest first,
//! a page at a time. Detections arrive at `POST /v1/anticheat/detections` (`anticheat.rs`) and are never public.

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::{access::Staff, players::parse_player, servers::KeyServerRef};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    players::privileges::Privilege,
};

const PAGE_SIZE: i64 = 50;

/// One detection, as the anti-cheat reported it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Detection {
    pub id: i64,
    /// The server that sent it.
    pub server: KeyServerRef,
    /// The player's name on that server then.
    pub player_name: String,
    pub map: String,
    /// What the anti-cheat reported, as text.
    pub message: String,
    /// By the game server's clock.
    pub detected_at: DateTime<Utc>,
    pub received_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Detections {
    /// Newest first.
    pub detections: Vec<Detection>,
    /// Pass as `before` for the next 50 older detections; null when there are none.
    pub older: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct DetectionsQuery {
    /// From a page's `older`: the detections before it.
    before: Option<String>,
}

/// One player's anti-cheat detections, 50 at a time, newest first. Any `SteamID` answers, with none for a
/// player never reported.
#[utoipa::path(
    get,
    path = "/v1/staff/players/{player}/detections",
    tag = "staff",
    params(("player" = String, Path, description = "SteamID64, SteamID2 or SteamID3"), DetectionsQuery),
    responses(
        (status = OK, body = Detections),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs review_anticheat", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a SteamID or not a detections cursor", body = ErrorBody),
    ),
)]
pub async fn get_player_detections(
    State(state): State<AppState>,
    staff: Staff,
    Path(player): Path<String>,
    Query(query): Query<DetectionsQuery>,
) -> Result<Json<Detections>, ApiError> {
    staff.require(Privilege::ReviewAnticheat)?;
    let player = parse_player(&player)?;
    // Cursors are the last detection's ID. IDs only grow, so a page never skips or repeats one when new
    // detections arrive while staff read; ordering by ID rather than `detected_at` also keeps a server's wrong
    // clock from hiding anything.
    let before = query.before.as_deref().map_or(Ok(i64::MAX), |cursor| {
        cursor
            .parse()
            .map_err(|_| ApiError::Invalid("that isn't a detections cursor".to_owned()))
    })?;
    let mut detections: Vec<Detection> = sqlx::query!(
        r#"
        SELECT d.id, d.server_id, s.name AS server_name, d.player_name, m.name AS map, d.message, d.detected_at,
               d.received_at
        FROM anticheat_detections d
        JOIN servers s ON s.id = d.server_id
        JOIN maps m ON m.id = d.map_id
        WHERE d.player_steamid64 = $1 AND d.id < $2
        ORDER BY d.id DESC
        LIMIT $3
        "#,
        player.get(),
        before,
        PAGE_SIZE + 1
    )
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|row| Detection {
        id: row.id,
        server: KeyServerRef {
            id: row.server_id,
            name: row.server_name,
        },
        player_name: row.player_name,
        map: row.map,
        message: row.message,
        detected_at: row.detected_at,
        received_at: row.received_at,
    })
    .collect();
    // The extra row only says that an older page exists.
    let older = if detections.len() > usize::try_from(PAGE_SIZE).expect("small") {
        detections.pop();
        detections.last().map(|detection| detection.id.to_string())
    } else {
        None
    };
    Ok(Json(Detections { detections, older }))
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::json;
    use sqlx::PgPool;

    use super::*;
    use crate::{
        auth::sessions,
        players::{
            SteamId64,
            privileges::{self, Privileges},
        },
        servers::keys,
        test_client,
    };

    const STAFF: &str = "76561197960287920";
    const GABE: &str = "76561197960287930";

    async fn session(db: &PgPool, held: &[Privilege]) -> String {
        let steamid64 = SteamId64::parse_any(STAFF).unwrap();
        privileges::grant(db, steamid64, Privileges::of(held))
            .await
            .unwrap();
        sessions::create(db, steamid64).await.unwrap()
    }

    async fn read(db: &PgPool, token: &str, path: &str) -> test_client::TestResponse {
        let request = Request::builder()
            .uri(path)
            .header("cookie", format!("{}={token}", sessions::COOKIE))
            .body(Body::empty())
            .unwrap();
        test_client::send(db, request).await
    }

    async fn report(db: &PgPool, key: &str, steamid64: &str, id: usize) {
        let detection = json!({
            "server_detection_id": format!("d{id}"),
            "player": { "steamid64": steamid64, "name": "gabe" },
            "map": "bhop_badges",
            "message": format!("detection {id}"),
            "detected_at": 1_797_600_000 + id,
        });
        let sent = test_client::post(db, "/v1/anticheat/detections", Some(key), &detection).await;
        assert_eq!(sent.status, 201);
    }

    #[sqlx::test]
    async fn pages_through_one_players_detections_newest_first(db: PgPool) {
        let key = keys::issue(&db, "Test server").await.unwrap().key;
        for id in 0..55 {
            report(&db, &key, GABE, id).await;
        }
        report(&db, &key, STAFF, 99).await;
        let token = session(&db, &[Privilege::ReviewAnticheat]).await;

        let path = format!("/v1/staff/players/{GABE}/detections");
        let first: Detections = read(&db, &token, &path).await.json();
        assert_eq!(first.detections.len(), 50);
        assert_eq!(first.detections[0].message, "detection 54");
        assert_eq!(first.detections[0].server.name, "Test server");
        let older = first.older.expect("a second page");
        let second: Detections = read(&db, &token, &format!("{path}?before={older}"))
            .await
            .json();
        let messages: Vec<&str> = second.detections.iter().map(|d| &*d.message).collect();
        assert_eq!(
            messages,
            [
                "detection 4",
                "detection 3",
                "detection 2",
                "detection 1",
                "detection 0"
            ]
        );
        assert!(second.older.is_none());

        let bad = read(&db, &token, &format!("{path}?before=soon")).await;
        assert_eq!(bad.status, 422);
        // Reviewers open the player's Manage view, where detections are shown.
        let manage = read(&db, &token, &format!("/v1/staff/players/{GABE}")).await;
        assert_eq!(manage.status, 200);
    }

    #[sqlx::test]
    async fn needs_review_anticheat(db: PgPool) {
        let others: Vec<Privilege> = Privilege::ALL
            .into_iter()
            .filter(|&p| p.is_staff() && p != Privilege::ReviewAnticheat)
            .collect();
        let token = session(&db, &others).await;
        let path = format!("/v1/staff/players/{GABE}/detections");
        assert_eq!(read(&db, &token, &path).await.status, 403);
    }
}
