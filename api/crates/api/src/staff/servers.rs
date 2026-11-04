//! Staff tools for game servers, which the servers page shows to staff: every server's latest heartbeat with
//! its versions, plugins and compliance, and the list of servers the site shows. Needs `manage_servers`.
//!
//! Servers always reach us: SourceJump never contacts a game server, so all of this is what each server
//! last reported. The command line lists and unlists through `set_listed` here too, so each change is logged.
//! Staff also mark listed servers as whitelist servers, which the list shows apart from public ones.

use std::net::SocketAddr;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, types::Json as JsonColumn};
use utoipa::ToSchema;

use super::{
    access::Staff,
    log::{self, StaffAction, player_ref},
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    maps::image::MapImage,
    players::{PlayerRef, SteamId64, privileges::Privilege},
    servers::{heartbeat::LoadedPlugin, list::ListedServer, listing},
    storage::Storage,
};

/// Lists or unlists the server at `address` and logs it. False when it already was as asked, which logs
/// nothing.
pub async fn set_listed(
    db: &PgPool,
    actor: Option<SteamId64>,
    address: SocketAddr,
    listed: bool,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let changed = if listed {
        listing::list(&mut *tx, address, actor).await?
    } else {
        listing::unlist(&mut *tx, address).await?
    };
    if changed {
        let entry = log::Entry {
            actor,
            action: if listed {
                StaffAction::ListServer
            } else {
                StaffAction::UnlistServer
            },
            target: &address.to_string(),
            reason: None,
            detail: json!({}),
        };
        log::record(&mut tx, entry).await?;
    }
    tx.commit().await?;
    Ok(changed)
}

/// Marks the listed server at `address` as a whitelist server, or as public, and logs it. None when it isn't
/// listed; false when it already was as asked, which logs nothing.
pub async fn set_whitelist(
    db: &PgPool,
    actor: Option<SteamId64>,
    address: SocketAddr,
    whitelist: bool,
) -> Result<Option<bool>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let was = sqlx::query_scalar!(
        "SELECT whitelist FROM server_listings WHERE ip = $1::inet AND port = $2 FOR UPDATE",
        address.ip().to_string() as _,
        i32::from(address.port())
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some(was) = was else {
        return Ok(None);
    };
    if was == whitelist {
        return Ok(Some(false));
    }
    sqlx::query!(
        "UPDATE server_listings SET whitelist = $3 WHERE ip = $1::inet AND port = $2",
        address.ip().to_string() as _,
        i32::from(address.port()),
        whitelist
    )
    .execute(&mut *tx)
    .await?;
    let entry = log::Entry {
        actor,
        action: if whitelist {
            StaffAction::MarkServerWhitelist
        } else {
            StaffAction::MarkServerPublic
        },
        target: &address.to_string(),
        reason: None,
        detail: json!({}),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(Some(true))
}

/// A server staff have listed, or one that has sent a heartbeat, or both.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffServer {
    /// `ip:port`, as players connect to it.
    pub address: String,
    /// Present when it's on the site's server list.
    pub listing: Option<ServerListing>,
    /// The server as the public list shows it; none for a server listed before it was ever heard from.
    pub server: Option<ListedServer>,
    /// The rest of its latest heartbeat, for staff; present exactly when `server` is.
    pub report: Option<ServerReport>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ServerListing {
    pub listed_at: DateTime<Utc>,
    /// None when listed from the command line.
    pub listed_by: Option<PlayerRef>,
}

/// What the server last reported about itself beyond what the public list shows.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ServerReport {
    /// The server's own `ip` setting, when it differs from where its heartbeats come from (NAT, or a lie).
    pub reported_ip: Option<String>,
    pub plugin_version: String,
    pub sourcemod_version: String,
    pub shavit_version: String,
    pub ruleset_version: Option<i32>,
    pub compliant: bool,
    /// What doesn't match the ruleset, as the plugin worded it.
    pub problems: Vec<String>,
    pub plugins: Vec<LoadedPlugin>,
    /// The keyed server it identified as, when its heartbeat came with a valid key.
    pub key_server: Option<KeyServerRef>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct KeyServerRef {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StaffServers {
    /// In the public list's order (online first, busiest first, then most recently heard); listed servers
    /// never heard from come last.
    pub servers: Vec<StaffServer>,
}

/// Every listed server and every server that has sent a heartbeat. The servers page shows these to staff in
/// place of the public list.
/// One row of the staff server list's query: a listing, a heartbeat, or both.
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent facts about a server, not states of one"
)]
struct StaffServerRow {
    ip: String,
    port: i32,
    country_code: Option<String>,
    whitelist: bool,
    listed_at: Option<DateTime<Utc>>,
    listed_by_steamid64: Option<String>,
    listed_by_name: Option<String>,
    listed_by_avatar_url: Option<String>,
    listed_by_country_code: Option<String>,
    received_at: Option<DateTime<Utc>>,
    seen_minutes_ago: Option<i32>,
    online: bool,
    hostname: Option<String>,
    reported_ip: Option<String>,
    map: Option<String>,
    map_has_page: bool,
    image_id: Option<i64>,
    image_key: Option<String>,
    image_focus: Option<i16>,
    players: Option<i32>,
    max_slots: Option<i32>,
    connected: bool,
    plugin_version: Option<String>,
    sourcemod_version: Option<String>,
    shavit_version: Option<String>,
    ruleset_version: Option<i32>,
    compliant: Option<bool>,
    problems: Option<JsonColumn<Vec<String>>>,
    plugins: Option<JsonColumn<Vec<LoadedPlugin>>>,
    key_server_id: Option<i64>,
    key_server_name: Option<String>,
}

impl StaffServerRow {
    fn into_staff_server(self, storage: &Storage) -> StaffServer {
        let map_image = MapImage::cover(storage, self.image_id, self.image_key, self.image_focus);
        // A listed server never heard from has a listing and nothing else.
        let (server, report) = self
            .received_at
            .map(|last_seen_at| {
                let server = ListedServer {
                    ip: self.ip.clone(),
                    port: self.port,
                    country_code: self.country_code,
                    hostname: self.hostname.unwrap_or_default(),
                    map: self.map.unwrap_or_default(),
                    map_has_page: self.map_has_page,
                    map_image,
                    players: self.players.unwrap_or_default(),
                    max_slots: self.max_slots.unwrap_or_default(),
                    online: self.online,
                    last_seen_at,
                    seen_minutes_ago: self.seen_minutes_ago.unwrap_or_default(),
                    connected: self.connected,
                    whitelist: self.whitelist,
                };
                let report = ServerReport {
                    reported_ip: self.reported_ip,
                    plugin_version: self.plugin_version.unwrap_or_default(),
                    sourcemod_version: self.sourcemod_version.unwrap_or_default(),
                    shavit_version: self.shavit_version.unwrap_or_default(),
                    ruleset_version: self.ruleset_version,
                    compliant: self.compliant.unwrap_or(false),
                    problems: self.problems.map(|json| json.0).unwrap_or_default(),
                    plugins: self.plugins.map(|json| json.0).unwrap_or_default(),
                    key_server: self
                        .key_server_id
                        .zip(self.key_server_name)
                        .map(|(id, name)| KeyServerRef { id, name }),
                };
                (server, report)
            })
            .unzip();
        StaffServer {
            address: format!("{}:{}", self.ip, self.port),
            listing: self.listed_at.map(|listed_at| ServerListing {
                listed_at,
                listed_by: player_ref(
                    self.listed_by_steamid64,
                    self.listed_by_name,
                    self.listed_by_avatar_url,
                    self.listed_by_country_code,
                ),
            }),
            server,
            report,
        }
    }
}

#[utoipa::path(
    get,
    path = "/v1/staff/servers",
    tag = "staff",
    responses(
        (status = OK, body = StaffServers),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_servers", body = ErrorBody),
    ),
)]
pub async fn list_staff_servers(
    State(state): State<AppState>,
    staff: Staff,
) -> Result<Json<StaffServers>, ApiError> {
    staff.require(Privilege::ManageServers)?;
    // The report is read field by field rather than as one typed value, so a heartbeat stored before a
    // field was added still shows.
    let rows = sqlx::query_as!(
        StaffServerRow,
        r#"
        WITH policy AS (
            SELECT (value->>'online_minutes')::int AS online_minutes
            FROM policies WHERE name = 'servers' ORDER BY version DESC LIMIT 1
        )
        SELECT host(coalesce(h.ip, l.ip)) AS "ip!", coalesce(h.port, l.port) AS "port!",
               h.country_code AS "country_code?", coalesce(l.whitelist, false) AS "whitelist!",
               l.listed_at AS "listed_at?",
               lb.steamid64::text AS "listed_by_steamid64?", lb.name AS "listed_by_name?",
               lb.avatar_url AS listed_by_avatar_url, lb.country_code AS listed_by_country_code,
               h.received_at AS "received_at?",
               floor(extract(epoch FROM now() - h.received_at) / 60)::int AS seen_minutes_ago,
               coalesce(h.received_at > now() - make_interval(mins => (SELECT online_minutes FROM policy)), false)
                   AS "online!",
               h.report->>'hostname' AS hostname,
               NULLIF(h.report->>'ip', host(h.ip)) AS reported_ip,
               h.report->>'map' AS map,
               m.last_run_at IS NOT NULL AS "map_has_page!",
               ci.id AS "image_id?", ci.key AS "image_key?", ci.focus AS "image_focus?",
               (h.report->>'players')::int AS players,
               (h.report->>'max_slots')::int AS max_slots,
               EXISTS (
                   SELECT 1 FROM server_keys k WHERE k.server_id = h.server_id AND k.revoked_at IS NULL
               ) AS "connected!",
               h.report->>'plugin_version' AS plugin_version,
               h.report->>'sourcemod_version' AS sourcemod_version,
               h.report->>'shavit_version' AS shavit_version,
               (h.report->>'ruleset_version')::int AS ruleset_version,
               (h.report->'compliance'->>'compliant')::boolean AS compliant,
               h.report->'compliance'->'problems' AS "problems: JsonColumn<Vec<String>>",
               h.report->'plugins' AS "plugins: JsonColumn<Vec<LoadedPlugin>>",
               s.id AS "key_server_id?", s.name AS "key_server_name?"
        FROM server_heartbeats h
        FULL JOIN server_listings l ON l.ip = h.ip AND l.port = h.port
        LEFT JOIN players lb ON lb.steamid64 = l.listed_by
        LEFT JOIN servers s ON s.id = h.server_id
        LEFT JOIN maps m ON m.name = h.report->>'map'
        LEFT JOIN map_images ci ON ci.map_id = m.id AND ci.position = 0
        ORDER BY "online!" DESC, (h.report->>'players')::int DESC NULLS LAST, h.received_at DESC NULLS LAST,
                 l.listed_at DESC
        "#
    )
    .fetch_all(&state.db)
    .await?;

    let servers = rows
        .into_iter()
        .map(|row| row.into_staff_server(&state.storage))
        .collect();
    Ok(Json(StaffServers { servers }))
}

fn parse_address(address: &str) -> Result<SocketAddr, ApiError> {
    address.parse().map_err(|_| {
        ApiError::Invalid(format!(
            "{address:?} isn't an address like 203.0.113.10:27015"
        ))
    })
}

/// Show a server on the site's server list. Listing an address that isn't heard from yet is allowed.
#[utoipa::path(
    put,
    path = "/v1/staff/listings/{address}",
    tag = "staff",
    params(("address" = String, Path, description = "`ip:port`")),
    responses(
        (status = NO_CONTENT, description = "Listed, or already was"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_servers, from SourceJump's pages", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not an address", body = ErrorBody),
    ),
)]
pub async fn list_server(
    State(state): State<AppState>,
    staff: Staff,
    Path(address): Path<String>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageServers)?;
    set_listed(
        &state.db,
        Some(staff.steamid64),
        parse_address(&address)?,
        true,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Take a server off the site's server list. Its heartbeats are still received.
#[utoipa::path(
    delete,
    path = "/v1/staff/listings/{address}",
    tag = "staff",
    params(("address" = String, Path, description = "`ip:port`")),
    responses(
        (status = NO_CONTENT, description = "Unlisted, or wasn't listed"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_servers, from SourceJump's pages", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not an address", body = ErrorBody),
    ),
)]
pub async fn unlist_server(
    State(state): State<AppState>,
    staff: Staff,
    Path(address): Path<String>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageServers)?;
    set_listed(
        &state.db,
        Some(staff.steamid64),
        parse_address(&address)?,
        false,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Mark a listed server as a whitelist server: one that lets in only players it has approved.
#[utoipa::path(
    put,
    path = "/v1/staff/listings/{address}/whitelist",
    tag = "staff",
    params(("address" = String, Path, description = "`ip:port`")),
    responses(
        (status = NO_CONTENT, description = "Marked, or already was"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_servers, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "Not a listed server", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not an address", body = ErrorBody),
    ),
)]
pub async fn mark_whitelist(
    State(state): State<AppState>,
    staff: Staff,
    Path(address): Path<String>,
) -> Result<StatusCode, ApiError> {
    whitelist_route(state, staff, &address, true).await
}

/// Mark a listed server as public again.
#[utoipa::path(
    delete,
    path = "/v1/staff/listings/{address}/whitelist",
    tag = "staff",
    params(("address" = String, Path, description = "`ip:port`")),
    responses(
        (status = NO_CONTENT, description = "Marked, or already was"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_servers, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "Not a listed server", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not an address", body = ErrorBody),
    ),
)]
pub async fn mark_public(
    State(state): State<AppState>,
    staff: Staff,
    Path(address): Path<String>,
) -> Result<StatusCode, ApiError> {
    whitelist_route(state, staff, &address, false).await
}

async fn whitelist_route(
    state: AppState,
    staff: Staff,
    address: &str,
    whitelist: bool,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageServers)?;
    let address = parse_address(address)?;
    match set_whitelist(&state.db, Some(staff.steamid64), address, whitelist).await? {
        Some(_) => Ok(StatusCode::NO_CONTENT),
        None => Err(ApiError::NotFound("that server isn't listed")),
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::Value;
    use sqlx::PgPool;

    use super::*;
    use crate::{
        auth::sessions,
        players::privileges::{self, Privileges},
        test_client::{self, TestResponse},
    };

    const STAFF: &str = "76561197960287930";
    const OTHER: &str = "76561197960287931";

    async fn session(db: &PgPool, steamid: &str, held: &[Privilege]) -> String {
        let steamid64 = SteamId64::parse_any(steamid).unwrap();
        privileges::grant(db, steamid64, Privileges::of(held))
            .await
            .unwrap();
        sessions::create(db, steamid64).await.unwrap()
    }

    async fn send(db: &PgPool, method: &str, path: &str, token: &str) -> TestResponse {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header("origin", "https://sourcejump.test")
            .header("cookie", format!("{}={token}", sessions::COOKIE))
            .body(Body::empty())
            .unwrap();
        test_client::send(db, request).await
    }

    async fn heartbeat(db: &PgPool, hostname: &str, ip: &str) {
        let example: Value =
            serde_json::from_str(include_str!("../../../../contract/servers-heartbeat.json"))
                .unwrap();
        let mut body = example["request"].clone();
        body["hostname"] = hostname.into();
        body["ip"] = ip.into();
        body["compliance"] =
            serde_json::json!({ "compliant": false, "problems": ["sv_airaccelerate is 150"] });
        assert_eq!(
            test_client::post(db, "/v1/servers/heartbeat", None, &body)
                .await
                .status,
            200
        );
    }

    #[sqlx::test]
    async fn staff_see_every_heartbeat_and_listing(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManageServers]).await;
        heartbeat(&db, "Heard", "198.51.100.7").await;
        listing::list(&db, "203.0.113.9:27015".parse().unwrap(), None)
            .await
            .unwrap();

        let list: StaffServers = send(&db, "GET", "/v1/staff/servers", &token).await.json();
        assert_eq!(list.servers.len(), 2);
        let heard = &list.servers[0];
        assert_eq!(heard.server.as_ref().unwrap().hostname, "Heard");
        let report = heard.report.as_ref().unwrap();
        // Tests send from 127.0.0.1, so the reported IP differs and is shown.
        assert_eq!(report.reported_ip.as_deref(), Some("198.51.100.7"));
        assert!(heard.server.as_ref().unwrap().online && !report.compliant);
        assert_eq!(report.problems, ["sv_airaccelerate is 150"]);
        assert_eq!(report.plugins[0].name, "shavit-core.smx");
        assert!(heard.listing.is_none());
        let silent = &list.servers[1];
        assert_eq!(silent.address, "203.0.113.9:27015");
        assert!(silent.server.is_none() && silent.report.is_none() && silent.listing.is_some());
    }

    #[sqlx::test]
    async fn staff_list_and_unlist_and_each_change_is_logged(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManageServers]).await;
        let path = "/v1/staff/listings/203.0.113.9:27015";
        for method in ["PUT", "PUT", "DELETE", "DELETE"] {
            assert_eq!(send(&db, method, path, &token).await.status, 204);
        }
        let list: StaffServers = send(&db, "GET", "/v1/staff/servers", &token).await.json();
        assert!(list.servers.is_empty());

        let logged: Vec<String> = sqlx::query_scalar!("SELECT action FROM staff_log ORDER BY id")
            .fetch_all(&db)
            .await
            .unwrap();
        assert_eq!(logged, ["list_server", "unlist_server"]);

        assert_eq!(
            send(&db, "PUT", "/v1/staff/listings/nowhere", &token)
                .await
                .status,
            422
        );
    }

    #[sqlx::test]
    async fn staff_mark_listed_servers_whitelist_and_each_change_is_logged(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManageServers]).await;
        // Test heartbeats come from 127.0.0.1.
        let path = "/v1/staff/listings/127.0.0.1:27015/whitelist";
        assert_eq!(send(&db, "PUT", path, &token).await.status, 404);

        heartbeat(&db, "Whitelist", "203.0.113.9").await;
        send(&db, "PUT", "/v1/staff/listings/127.0.0.1:27015", &token).await;
        for method in ["PUT", "PUT", "DELETE", "DELETE", "PUT"] {
            assert_eq!(send(&db, method, path, &token).await.status, 204);
        }
        let list: StaffServers = send(&db, "GET", "/v1/staff/servers", &token).await.json();
        assert!(list.servers[0].server.as_ref().unwrap().whitelist);

        let logged: Vec<String> = sqlx::query_scalar!("SELECT action FROM staff_log ORDER BY id")
            .fetch_all(&db)
            .await
            .unwrap();
        assert_eq!(
            logged,
            [
                "list_server",
                "mark_server_whitelist",
                "mark_server_public",
                "mark_server_whitelist"
            ]
        );
    }

    #[sqlx::test]
    async fn the_listed_by_staff_member_is_named(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManageServers]).await;
        send(&db, "PUT", "/v1/staff/listings/203.0.113.9:27015", &token).await;
        let list: StaffServers = send(&db, "GET", "/v1/staff/servers", &token).await.json();
        let by = list.servers[0]
            .listing
            .as_ref()
            .unwrap()
            .listed_by
            .as_ref()
            .unwrap();
        assert_eq!(by.steamid64, STAFF);
    }

    #[sqlx::test]
    async fn servers_need_manage_servers(db: PgPool) {
        let token = session(&db, OTHER, &[Privilege::ManageKeys]).await;
        assert_eq!(
            send(&db, "GET", "/v1/staff/servers", &token).await.status,
            403
        );
        let path = "/v1/staff/listings/203.0.113.9:27015";
        assert_eq!(send(&db, "PUT", path, &token).await.status, 403);
        assert_eq!(send(&db, "DELETE", path, &token).await.status, 403);
        let whitelist = "/v1/staff/listings/203.0.113.9:27015/whitelist";
        assert_eq!(send(&db, "PUT", whitelist, &token).await.status, 403);
    }
}
