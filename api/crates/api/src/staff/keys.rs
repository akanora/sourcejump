//! Staff tools for server API keys: every keyed server with its current key, issuing, replacing and revoking.
//! Needs `manage_keys`.
//!
//! Sensitive path, fails closed. A new key appears in one response and is stored nowhere; the staff log
//! records only its prefix. A server holds one key at a time, so a new key for a server replaces its old one.
//! The command line issues and revokes through `issue` and `revoke` here too, so every key change is logged.
//! Revoking can also invalidate every run the server sent, which needs `invalidate_runs`.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use utoipa::ToSchema;

use super::{
    access::Staff,
    log::{self, StaffAction, check_reason},
    runs::{self, RunsOf},
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    players::{SteamId64, privileges::Privilege},
    servers::keys::{self, Replacement},
};

const MAX_SERVER_NAME_CHARS: usize = 64;

/// Which server a new key is for.
pub enum KeyFor<'a> {
    /// A server SourceJump doesn't know yet, by the name staff give it.
    NewServer(&'a str),
    Server(i64),
}

/// Issues a key and logs it; for an existing server, its active key is revoked in the same step and the log
/// says it was replaced. None when `KeyFor::Server` names no server.
pub async fn issue(
    db: &PgPool,
    actor: Option<SteamId64>,
    server: KeyFor<'_>,
) -> Result<Option<Replacement>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let replacement = match server {
        KeyFor::NewServer(name) => Some(Replacement {
            issued: keys::issue(&mut *tx, name).await?,
            replaced: None,
        }),
        KeyFor::Server(id) => keys::replace(&mut tx, id).await?,
    };
    let Some(replacement) = replacement else {
        return Ok(None);
    };
    let mut detail = server_detail(&mut tx, replacement.issued.server_id).await?;
    let action = match &replacement.replaced {
        Some(old) => {
            detail["replaced"] = json!(old);
            StaffAction::ReplaceKey
        }
        None => StaffAction::IssueKey,
    };
    let entry = log::Entry {
        actor,
        action,
        target: &replacement.issued.prefix,
        reason: None,
        detail,
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(Some(replacement))
}

/// Revokes the active key with this prefix and logs it, invalidating every valid run its server sent too when
/// asked (logged as its own action, in the same transaction). False when no active key has it.
pub async fn revoke(
    db: &PgPool,
    actor: Option<SteamId64>,
    prefix: &str,
    reason: Option<&str>,
    invalidate_runs: bool,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    if !keys::revoke(&mut *tx, prefix).await? {
        return Ok(false);
    }
    let server_id = sqlx::query_scalar!(
        "SELECT server_id FROM server_keys WHERE prefix = $1",
        prefix
    )
    .fetch_one(&mut *tx)
    .await?;
    let entry = log::Entry {
        actor,
        action: StaffAction::RevokeKey,
        target: prefix,
        reason,
        detail: server_detail(&mut tx, server_id).await?,
    };
    log::record(&mut tx, entry).await?;
    if invalidate_runs {
        runs::invalidate_runs_of(&mut tx, actor, RunsOf::Server(server_id), reason).await?;
    }
    tx.commit().await?;
    Ok(true)
}

/// The server's ID and its name at the time, so the log still reads right if it's renamed.
pub(super) async fn server_detail(
    conn: &mut sqlx::PgConnection,
    server_id: i64,
) -> Result<serde_json::Value, sqlx::Error> {
    let name = sqlx::query_scalar!("SELECT name FROM servers WHERE id = $1", server_id)
        .fetch_one(conn)
        .await?;
    Ok(json!({ "server_id": server_id, "server": name }))
}

/// A server SourceJump issued a key to.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct KeyedServer {
    pub id: i64,
    pub name: String,
    pub created_at: DateTime<Utc>,
    /// The latest heartbeat that came with one of its valid keys.
    pub last_heartbeat: Option<KeyedHeartbeat>,
    /// Its active key; null when its last key was revoked and not replaced.
    pub key: Option<ActiveKey>,
    /// When its last key was revoked, when it has no active key.
    pub revoked_at: Option<DateTime<Utc>>,
    /// Runs sent with any key it has held.
    pub runs: i64,
    /// How many of them are invalidated.
    pub invalidated_runs: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct KeyedHeartbeat {
    /// `ip:port`, where the heartbeat came from.
    pub address: String,
    pub hostname: String,
    pub received_at: DateTime<Utc>,
}

/// A key, by its prefix. The key itself is never stored, so it can't be shown again.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ActiveKey {
    pub prefix: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct KeyedServers {
    /// By name.
    pub servers: Vec<KeyedServer>,
}

/// Every server that holds or held a key, with its current key.
#[utoipa::path(
    get,
    path = "/v1/staff/keys",
    tag = "staff",
    responses(
        (status = OK, body = KeyedServers),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_keys", body = ErrorBody),
    ),
)]
pub async fn list_keys(
    State(state): State<AppState>,
    staff: Staff,
) -> Result<Json<KeyedServers>, ApiError> {
    staff.require(Privilege::ManageKeys)?;
    let rows = sqlx::query!(
        r#"
        SELECT s.id, s.name, s.created_at,
               active.prefix AS "key_prefix?", active.created_at AS "key_created_at?",
               (SELECT max(revoked_at) FROM server_keys WHERE server_id = s.id) AS last_revoked_at,
               (SELECT count(*) FROM runs r JOIN server_keys k ON k.id = r.key_id
                WHERE k.server_id = s.id) AS "runs!",
               (SELECT count(*) FROM runs r JOIN server_keys k ON k.id = r.key_id
                WHERE k.server_id = s.id AND r.invalidated_at IS NOT NULL) AS "invalidated_runs!",
               host(h.ip) || ':' || h.port AS address,
               h.report->>'hostname' AS hostname,
               h.received_at AS "received_at?"
        FROM servers s
        LEFT JOIN server_keys active ON active.server_id = s.id AND active.revoked_at IS NULL
        LEFT JOIN LATERAL (
            SELECT ip, port, report, received_at FROM server_heartbeats
            WHERE server_id = s.id ORDER BY received_at DESC LIMIT 1
        ) h ON true
        ORDER BY lower(s.name), s.id
        "#
    )
    .fetch_all(&state.db)
    .await?;
    let servers = rows
        .into_iter()
        .map(|row| {
            let key = match (row.key_prefix, row.key_created_at) {
                (Some(prefix), Some(created_at)) => Some(ActiveKey { prefix, created_at }),
                _ => None,
            };
            KeyedServer {
                last_heartbeat: match (row.address, row.hostname, row.received_at) {
                    (Some(address), Some(hostname), Some(received_at)) => Some(KeyedHeartbeat {
                        address,
                        hostname,
                        received_at,
                    }),
                    _ => None,
                },
                revoked_at: if key.is_none() {
                    row.last_revoked_at
                } else {
                    None
                },
                key,
                runs: row.runs,
                invalidated_runs: row.invalidated_runs,
                id: row.id,
                name: row.name,
                created_at: row.created_at,
            }
        })
        .collect();
    Ok(Json(KeyedServers { servers }))
}

/// For a new server, give `server_name`; for a new key to an existing one, replacing its old key, `server_id`.
/// Not both.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct IssueKeyRequest {
    pub server_id: Option<i64>,
    /// 1 to 64 characters, for staff to tell servers apart.
    pub server_name: Option<String>,
}

/// The new key, shown this once.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct IssuedKeyResponse {
    pub server_id: i64,
    pub prefix: String,
    /// The whole key. SourceJump keeps only a hash, so this is the only time it can be read.
    pub key: String,
    /// The prefix of the key it replaced, which no longer works; null when the server had none.
    pub replaced: Option<String>,
}

/// Issue a key, for a new server, or for an existing server, revoking its current key in the same step.
#[utoipa::path(
    post,
    path = "/v1/staff/keys",
    tag = "staff",
    request_body = IssueKeyRequest,
    responses(
        (status = CREATED, body = IssuedKeyResponse),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_keys, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such server", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Neither or both of server_id and server_name", body = ErrorBody),
    ),
)]
pub async fn issue_key(
    State(state): State<AppState>,
    staff: Staff,
    JsonBody(request): JsonBody<IssueKeyRequest>,
) -> Result<(StatusCode, Json<IssuedKeyResponse>), ApiError> {
    staff.require(Privilege::ManageKeys)?;
    let name;
    let server = match (request.server_id, request.server_name.as_deref()) {
        (Some(id), None) => KeyFor::Server(id),
        (None, Some(given)) => {
            name = given.trim().to_owned();
            if name.is_empty() || name.chars().count() > MAX_SERVER_NAME_CHARS {
                return Err(ApiError::Invalid(format!(
                    "a server name is 1 to {MAX_SERVER_NAME_CHARS} characters"
                )));
            }
            KeyFor::NewServer(&name)
        }
        _ => {
            return Err(ApiError::Invalid(
                "give either server_id or server_name".to_owned(),
            ));
        }
    };
    let Replacement { issued, replaced } = issue(&state.db, Some(staff.steamid64), server)
        .await?
        .ok_or(ApiError::NotFound("no such server"))?;
    Ok((
        StatusCode::CREATED,
        Json(IssuedKeyResponse {
            server_id: issued.server_id,
            prefix: issued.prefix,
            key: issued.key,
            replaced,
        }),
    ))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RevokeKeyRequest {
    /// Why, for the staff log. 1 to 500 characters.
    pub reason: String,
    /// Also invalidate every valid run the key's server sent, with this key or an earlier one, for the same
    /// reason. Needs `invalidate_runs`.
    #[serde(default)]
    pub invalidate_runs: bool,
}

/// Revoke a key, leaving its server without one. Every request with it is refused from then on. The runs the
/// server sent stay as they are unless `invalidate_runs` is set.
#[utoipa::path(
    post,
    path = "/v1/staff/keys/{prefix}/revoke",
    tag = "staff",
    params(("prefix" = String, Path, description = "The key's prefix, like `sj_4f1a9c0e`")),
    request_body = RevokeKeyRequest,
    responses(
        (status = NO_CONTENT, description = "Revoked"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_keys (and invalidate_runs to invalidate), from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No active key has this prefix", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "No reason given", body = ErrorBody),
    ),
)]
pub async fn revoke_key(
    State(state): State<AppState>,
    staff: Staff,
    Path(prefix): Path<String>,
    JsonBody(request): JsonBody<RevokeKeyRequest>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageKeys)?;
    if request.invalidate_runs {
        staff.require(Privilege::InvalidateRuns)?;
    }
    let reason = check_reason(&request.reason)?;
    let revoked = revoke(
        &state.db,
        Some(staff.steamid64),
        &prefix,
        Some(&reason),
        request.invalidate_runs,
    )
    .await?;
    if revoked {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound("no active key has this prefix"))
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::{Value, json};
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

    async fn heartbeat_status(db: &PgPool, key: &str) -> Value {
        let response = test_client::post(
            db,
            "/v1/servers/heartbeat",
            Some(key),
            &serde_json::from_str(include_str!("../../../../contract/servers-heartbeat.json"))
                .map(|example: Value| example["request"].clone())
                .unwrap(),
        )
        .await;
        response.json::<Value>()["key"].clone()
    }

    #[sqlx::test]
    async fn staff_issue_list_and_revoke_keys(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManageKeys]).await;

        let created = send(
            &db,
            "POST",
            "/v1/staff/keys",
            &token,
            Some(json!({ "server_name": "  Kawaii #2 " })),
        )
        .await;
        assert_eq!(created.status, 201);
        let first: IssuedKeyResponse = created.json();
        assert_eq!(heartbeat_status(&db, &first.key).await, "valid");

        let body = json!({ "server_id": first.server_id });
        let second: IssuedKeyResponse = send(&db, "POST", "/v1/staff/keys", &token, Some(body))
            .await
            .json();
        assert_eq!(second.server_id, first.server_id);
        assert_eq!(second.replaced.as_deref(), Some(first.prefix.as_str()));
        assert_eq!(heartbeat_status(&db, &first.key).await, "revoked");
        assert_eq!(heartbeat_status(&db, &second.key).await, "valid");

        let list: KeyedServers = send(&db, "GET", "/v1/staff/keys", &token, None)
            .await
            .json();
        assert_eq!(list.servers.len(), 1);
        let server = &list.servers[0];
        assert_eq!(server.name, "Kawaii #2");
        assert_eq!(server.key.as_ref().unwrap().prefix, second.prefix);
        assert_eq!(server.revoked_at, None);
        assert_eq!(
            server.last_heartbeat.as_ref().unwrap().hostname,
            "Example Bhop"
        );

        let path = format!("/v1/staff/keys/{}/revoke", second.prefix);
        let revoked = send(
            &db,
            "POST",
            &path,
            &token,
            Some(json!({ "reason": "Leaked in a screenshot" })),
        )
        .await;
        assert_eq!(revoked.status, 204);
        assert_eq!(heartbeat_status(&db, &second.key).await, "revoked");
        let again = send(
            &db,
            "POST",
            &path,
            &token,
            Some(json!({ "reason": "Twice" })),
        )
        .await;
        assert_eq!(again.status, 404);
        let list: KeyedServers = send(&db, "GET", "/v1/staff/keys", &token, None)
            .await
            .json();
        assert!(list.servers[0].key.is_none());
        assert!(list.servers[0].revoked_at.is_some());

        let logged =
            sqlx::query!("SELECT action, target, reason, detail FROM staff_log ORDER BY id")
                .fetch_all(&db)
                .await
                .unwrap();
        let actions: Vec<_> = logged
            .iter()
            .map(|row| (row.action.as_str(), row.target.as_str()))
            .collect();
        assert_eq!(
            actions,
            [
                ("issue_key", first.prefix.as_str()),
                ("replace_key", second.prefix.as_str()),
                ("revoke_key", second.prefix.as_str())
            ]
        );
        assert_eq!(logged[1].detail["replaced"], first.prefix.as_str());
        assert_eq!(logged[2].reason.as_deref(), Some("Leaked in a screenshot"));
        assert_eq!(logged[2].detail["server"], "Kawaii #2");
        // The key itself is in no log entry.
        assert!(logged.iter().all(|row| {
            [&first.key, &second.key]
                .iter()
                .all(|key| !row.detail.to_string().contains(key.as_str()))
        }));
    }

    #[sqlx::test]
    async fn issuing_needs_one_server_and_revoking_a_reason(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManageKeys]).await;
        for body in [
            json!({}),
            json!({ "server_id": 1, "server_name": "Both" }),
            json!({ "server_name": " " }),
        ] {
            assert_eq!(
                send(&db, "POST", "/v1/staff/keys", &token, Some(body))
                    .await
                    .status,
                422
            );
        }
        let missing = send(
            &db,
            "POST",
            "/v1/staff/keys",
            &token,
            Some(json!({ "server_id": 999 })),
        )
        .await;
        assert_eq!(missing.status, 404);

        let issued = keys::issue(&db, "Test server").await.unwrap();
        let path = format!("/v1/staff/keys/{}/revoke", issued.prefix);
        let unexplained = send(&db, "POST", &path, &token, Some(json!({ "reason": "" }))).await;
        assert_eq!(unexplained.status, 422);
    }

    #[sqlx::test]
    async fn keys_need_manage_keys(db: PgPool) {
        let token = session(&db, OTHER, &[Privilege::ManageServers]).await;
        assert_eq!(
            send(&db, "GET", "/v1/staff/keys", &token, None)
                .await
                .status,
            403
        );
        let body = json!({ "server_name": "Sneaky" });
        assert_eq!(
            send(&db, "POST", "/v1/staff/keys", &token, Some(body))
                .await
                .status,
            403
        );
        let issued = keys::issue(&db, "Test server").await.unwrap();
        let path = format!("/v1/staff/keys/{}/revoke", issued.prefix);
        let body = json!({ "reason": "Because" });
        assert_eq!(
            send(&db, "POST", &path, &token, Some(body)).await.status,
            403
        );
    }
}
