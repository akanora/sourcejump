//! `GET /v1/servers`: the servers staff have listed that have been heard from lately, as the server list
//! shows them.

use axum::{Json, extract::State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{app::AppState, error::ApiError, maps::image::MapImage};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ServerList {
    /// Online servers first, busiest first; then the rest, most recently seen first.
    pub servers: Vec<ListedServer>,
}

#[expect(
    clippy::struct_excessive_bools,
    reason = "independent facts about a server, not states of one"
)]
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ListedServer {
    /// Where players connect: the IP its heartbeats come from.
    pub ip: String,
    pub port: i32,
    /// Where Cloudflare places `ip`, as an ISO 3166-1 alpha-2 code; none when it didn't say.
    pub country_code: Option<String>,
    /// The in-game hostname, as plain text.
    pub hostname: String,
    pub map: String,
    /// Whether the map has a page: it's on the map list once a run on it is finished.
    pub map_has_page: bool,
    /// The map's picture, once staff add one.
    pub map_image: Option<MapImage>,
    pub players: i32,
    pub max_slots: i32,
    /// Heard from within the `servers` policy's `online_minutes`.
    pub online: bool,
    pub last_seen_at: DateTime<Utc>,
    /// Whole minutes since `last_seen_at`, by the API's clock, so clients needn't trust their own.
    pub seen_minutes_ago: i32,
    /// Its latest heartbeat came with a valid API key, so its runs count on SourceJump.
    pub connected: bool,
    /// Staff marked it as letting in only players it has approved. The list shows these apart.
    pub whitelist: bool,
}

/// Listed servers heard from within the `servers` policy's `listed_hours`. Without that policy the list is
/// empty, rather than guessing how long a server stays listed.
#[utoipa::path(
    get,
    path = "/v1/servers",
    tag = "servers",
    responses((status = OK, body = ServerList)),
)]
pub async fn list_servers(State(state): State<AppState>) -> Result<Json<ServerList>, ApiError> {
    let rows = sqlx::query!(
        r#"
        WITH policy AS (
            SELECT (value->>'online_minutes')::int AS online_minutes, (value->>'listed_hours')::int AS listed_hours
            FROM policies WHERE name = 'servers' ORDER BY version DESC LIMIT 1
        )
        SELECT host(h.ip) AS "ip!", h.port, h.country_code,
               h.report->>'hostname' AS "hostname!",
               h.report->>'map' AS "map!",
               m.last_run_at IS NOT NULL AS "map_has_page!",
               ci.id AS "image_id?", ci.key AS "image_key?", ci.focus AS "image_focus?",
               (h.report->>'players')::int AS "players!",
               (h.report->>'max_slots')::int AS "max_slots!",
               h.received_at > now() - make_interval(mins => policy.online_minutes) AS "online!",
               h.received_at AS last_seen_at,
               floor(extract(epoch FROM now() - h.received_at) / 60)::int AS "seen_minutes_ago!",
               EXISTS (
                   SELECT 1 FROM server_keys k WHERE k.server_id = h.server_id AND k.revoked_at IS NULL
               ) AS "connected!",
               l.whitelist
        FROM server_heartbeats h
        JOIN server_listings l ON l.ip = h.ip AND l.port = h.port
        CROSS JOIN policy
        LEFT JOIN maps m ON m.name = h.report->>'map'
        LEFT JOIN map_images ci ON ci.map_id = m.id AND ci.position = 0
        WHERE h.received_at > now() - make_interval(hours => policy.listed_hours)
        ORDER BY "online!" DESC, "players!" DESC, h.received_at DESC, "hostname!"
        "#
    )
    .fetch_all(&state.db)
    .await?;
    let servers = rows
        .into_iter()
        .map(|row| ListedServer {
            ip: row.ip,
            port: row.port,
            country_code: row.country_code,
            hostname: row.hostname,
            map: row.map,
            map_has_page: row.map_has_page,
            map_image: MapImage::cover(
                &state.storage,
                row.image_id,
                row.image_key,
                row.image_focus,
            ),
            players: row.players,
            max_slots: row.max_slots,
            online: row.online,
            last_seen_at: row.last_seen_at,
            seen_minutes_ago: row.seen_minutes_ago,
            connected: row.connected,
            whitelist: row.whitelist,
        })
        .collect();
    Ok(Json(ServerList { servers }))
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use super::ServerList;
    use crate::{
        servers::{
            heartbeat::tests::{beat, beat_from, report},
            keys, listing,
        },
        test_client,
    };

    async fn listed(db: &PgPool) -> Vec<(String, i32, bool, bool)> {
        let list: ServerList = test_client::get(db, "/v1/servers").await.json();
        list.servers
            .into_iter()
            .map(|s| {
                (
                    format!("{}:{}", s.ip, s.port),
                    s.players,
                    s.online,
                    s.connected,
                )
            })
            .collect()
    }

    #[sqlx::test]
    async fn shows_the_country_and_whitelist_mark(db: PgPool) {
        beat_from(&db, "203.0.113.1", Some("SE"), None, &report(27015)).await;
        beat(&db, "203.0.113.2", None, &report(27015)).await;
        for address in ["203.0.113.1:27015", "203.0.113.2:27015"] {
            listing::list(&db, address.parse().unwrap(), None)
                .await
                .unwrap();
        }
        sqlx::query("UPDATE server_listings SET whitelist = true WHERE ip = '203.0.113.2'")
            .execute(&db)
            .await
            .unwrap();

        let list: ServerList = test_client::get(&db, "/v1/servers").await.json();
        let mut marks: Vec<_> = list
            .servers
            .iter()
            .map(|s| (s.ip.as_str(), s.country_code.as_deref(), s.whitelist))
            .collect();
        marks.sort();
        assert_eq!(
            marks,
            [
                ("203.0.113.1", Some("SE"), false),
                ("203.0.113.2", None, true)
            ]
        );
    }

    #[sqlx::test]
    async fn shows_listed_servers_heard_from_lately(db: PgPool) {
        let issued = keys::issue(&db, "Keyed").await.unwrap();
        let mut busy = report(27015);
        busy["players"] = serde_json::json!(20);
        beat_from(&db, "203.0.113.1", Some("SE"), Some(&issued.key), &busy).await;
        beat(&db, "203.0.113.2", None, &report(27015)).await;
        beat(&db, "203.0.113.3", None, &report(27015)).await;
        beat(&db, "203.0.113.4", None, &report(27015)).await;
        for address in [
            "203.0.113.1:27015",
            "203.0.113.2:27015",
            "203.0.113.4:27015",
        ] {
            assert!(
                listing::list(&db, address.parse().unwrap(), None)
                    .await
                    .unwrap()
            );
        }
        // .4 went quiet an hour ago: still listed, but offline.
        sqlx::query("UPDATE server_heartbeats SET received_at = now() - interval '1 hour' WHERE ip = '203.0.113.4'")
            .execute(&db)
            .await
            .unwrap();

        assert_eq!(
            listed(&db).await,
            [
                ("203.0.113.1:27015".to_owned(), 20, true, true),
                ("203.0.113.2:27015".to_owned(), 12, true, false),
                ("203.0.113.4:27015".to_owned(), 12, false, false),
            ]
        );

        // A day of silence drops a server off; unlisting removes it at once; a revoked key disconnects.
        sqlx::query("UPDATE server_heartbeats SET received_at = now() - interval '25 hours' WHERE ip = '203.0.113.4'")
            .execute(&db)
            .await
            .unwrap();
        assert!(
            listing::unlist(&db, "203.0.113.2:27015".parse().unwrap())
                .await
                .unwrap()
        );
        keys::revoke(&db, &issued.prefix).await.unwrap();
        assert_eq!(
            listed(&db).await,
            [("203.0.113.1:27015".to_owned(), 20, true, false)]
        );
    }
}
