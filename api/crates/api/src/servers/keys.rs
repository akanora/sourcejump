//! Server API keys: issuing, replacing, revoking, and the `ServerKey` extractor that guards keyed endpoints.
//!
//! A server holds at most one active key (lead, 2026-10-21), which a unique index enforces.
//!
//! Sensitive path, fails closed: any request without a valid, unrevoked key is rejected. A key is `sj_`
//! plus 64 hex characters (32 random bytes). Only its SHA-256 is stored; a fast hash is enough because
//! the key is random, not a password, and nothing ever needs to read a key back.

use std::fmt::Write as _;

use axum::{extract::FromRequestParts, http::request::Parts};
use sha2::{Digest, Sha256};
use sqlx::{Acquire, PgConnection, PgExecutor, PgPool, Postgres};

use crate::{app::AppState, error::ApiError};

const KEY_TAG: &str = "sj_";
const KEY_BYTES: usize = 32;
// "sj_" plus 8 hex characters: 32 bits, plenty to tell one server's keys from another's.
const PREFIX_LEN: usize = KEY_TAG.len() + 8;

/// A newly issued key. `key` is shown to staff once and stored nowhere.
pub struct IssuedKey {
    pub server_id: i64,
    pub prefix: String,
    pub key: String,
}

/// Creates a server and its first key. Takes a pool or a caller's transaction, so staff tools can log it
/// in the same transaction.
pub async fn issue(
    db: impl Acquire<'_, Database = Postgres>,
    server_name: &str,
) -> Result<IssuedKey, sqlx::Error> {
    let mut tx = db.begin().await?;
    let server_id = sqlx::query_scalar!(
        "INSERT INTO servers (name) VALUES ($1) RETURNING id",
        server_name
    )
    .fetch_one(&mut *tx)
    .await?;
    let issued = add_key(&mut tx, server_id).await?;
    tx.commit().await?;
    Ok(issued)
}

/// A key that took over from the server's previous one.
pub struct Replacement {
    pub issued: IssuedKey,
    /// The prefix of the key it replaced, now revoked; None when the server had no active key.
    pub replaced: Option<String>,
}

/// Gives an existing server a new key, revoking its active key in the same step. None when there's no such
/// server.
pub async fn replace(
    conn: &mut PgConnection,
    server_id: i64,
) -> Result<Option<Replacement>, sqlx::Error> {
    // Locking the server row makes two replacements of one server's key wait for each other, so the second
    // revokes the first's new key rather than failing on the one-active-key index.
    let exists = sqlx::query_scalar!("SELECT id FROM servers WHERE id = $1 FOR UPDATE", server_id)
        .fetch_optional(&mut *conn)
        .await?
        .is_some();
    if !exists {
        return Ok(None);
    }
    let replaced = sqlx::query_scalar!(
        "UPDATE server_keys SET revoked_at = now() WHERE server_id = $1 AND revoked_at IS NULL
         RETURNING prefix",
        server_id
    )
    .fetch_optional(&mut *conn)
    .await?;
    let issued = add_key(conn, server_id).await?;
    Ok(Some(Replacement { issued, replaced }))
}

async fn add_key(conn: &mut PgConnection, server_id: i64) -> Result<IssuedKey, sqlx::Error> {
    let key = generate();
    let prefix = key[..PREFIX_LEN].to_owned();
    sqlx::query!(
        "INSERT INTO server_keys (server_id, prefix, hash) VALUES ($1, $2, $3)",
        server_id,
        prefix,
        &hash(&key)[..]
    )
    .execute(conn)
    .await?;
    Ok(IssuedKey {
        server_id,
        prefix,
        key,
    })
}

/// Revokes the key with this prefix. Returns false if no unrevoked key has it.
pub async fn revoke(db: impl PgExecutor<'_>, prefix: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        "UPDATE server_keys SET revoked_at = now() WHERE prefix = $1 AND revoked_at IS NULL",
        prefix
    )
    .execute(db)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// What a presented key turned out to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyLookup {
    Valid { key_id: i64, server_id: i64 },
    Revoked { server_id: i64 },
    Unknown,
}

/// Looks up a presented key. Anything that isn't one of our keys is `Unknown`.
pub async fn look_up(db: &PgPool, presented: &str) -> Result<KeyLookup, sqlx::Error> {
    let row = sqlx::query!(
        "SELECT id, server_id, revoked_at IS NOT NULL AS \"revoked!\" FROM server_keys WHERE hash = $1",
        &hash(presented)[..]
    )
    .fetch_optional(db)
    .await?;

    Ok(match row {
        None => KeyLookup::Unknown,
        Some(row) if row.revoked => KeyLookup::Revoked {
            server_id: row.server_id,
        },
        Some(row) => KeyLookup::Valid {
            key_id: row.id,
            server_id: row.server_id,
        },
    })
}

/// The bearer token from an `Authorization` header, if there is one.
pub fn bearer(parts: &Parts) -> Option<&str> {
    parts
        .headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

/// Proof that the request carried a valid, unrevoked key. Taking it as a handler argument makes the
/// endpoint keyed: requests without one are answered 401 before the handler runs.
#[derive(Debug, Clone, Copy)]
pub struct ServerKey {
    pub key_id: i64,
    pub server_id: i64,
}

impl FromRequestParts<AppState> for ServerKey {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let presented = bearer(parts).ok_or(ApiError::Unauthorized("an API key is required"))?;
        match look_up(&state.db, presented).await? {
            KeyLookup::Valid { key_id, server_id } => Ok(Self { key_id, server_id }),
            KeyLookup::Revoked { .. } => Err(ApiError::Unauthorized("this API key was revoked")),
            KeyLookup::Unknown => Err(ApiError::Unauthorized("this API key is not valid")),
        }
    }
}

fn generate() -> String {
    let mut bytes = [0u8; KEY_BYTES];
    getrandom::fill(&mut bytes).expect("the operating system's random source failed");
    let mut key = String::with_capacity(KEY_TAG.len() + KEY_BYTES * 2);
    key.push_str(KEY_TAG);
    for byte in bytes {
        write!(key, "{byte:02x}").expect("writing to a String can't fail");
    }
    key
}

fn hash(key: &str) -> [u8; 32] {
    Sha256::digest(key.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, http::Request, routing::get};
    use sqlx::PgPool;
    use tower::ServiceExt;

    use super::*;

    async fn status_with(db: PgPool, authorization: Option<&str>) -> u16 {
        let app = Router::new()
            .route("/keyed", get(|_: ServerKey| async { "ok" }))
            .with_state(AppState::for_tests(db));
        let mut request = Request::get("/keyed");
        if let Some(value) = authorization {
            request = request.header("authorization", value);
        }
        let response = app
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        response.status().as_u16()
    }

    #[sqlx::test]
    async fn an_issued_key_is_accepted(db: PgPool) {
        let issued = issue(&db, "Test server").await.unwrap();

        assert_eq!(issued.key.len(), 67);
        assert!(issued.key.starts_with(&issued.prefix));
        let status = status_with(db, Some(&format!("Bearer {}", issued.key))).await;
        assert_eq!(status, 200);
    }

    #[sqlx::test]
    async fn requests_without_a_valid_key_are_rejected(db: PgPool) {
        let issued = issue(&db, "Test server").await.unwrap();
        let other_last = if issued.key.ends_with('0') { '1' } else { '0' };
        let wrong = format!("Bearer {}{other_last}", &issued.key[..66]);

        assert_eq!(status_with(db.clone(), None).await, 401);
        assert_eq!(status_with(db.clone(), Some(&issued.key)).await, 401);
        assert_eq!(status_with(db.clone(), Some(&wrong)).await, 401);
        assert_eq!(status_with(db, Some("Bearer ")).await, 401);
    }

    #[sqlx::test]
    async fn a_new_key_replaces_the_servers_old_one(db: PgPool) {
        let first = issue(&db, "Test server").await.unwrap();
        let mut conn = db.acquire().await.unwrap();
        let second = replace(&mut conn, first.server_id).await.unwrap().unwrap();
        assert_eq!(second.issued.server_id, first.server_id);
        assert_eq!(second.replaced.as_deref(), Some(first.prefix.as_str()));
        assert!(
            replace(&mut conn, first.server_id + 1)
                .await
                .unwrap()
                .is_none()
        );
        drop(conn);
        let old = status_with(db.clone(), Some(&format!("Bearer {}", first.key))).await;
        let new = status_with(db.clone(), Some(&format!("Bearer {}", second.issued.key))).await;
        assert_eq!((old, new), (401, 200));
    }

    #[sqlx::test]
    async fn a_server_without_a_key_gets_one(db: PgPool) {
        let first = issue(&db, "Test server").await.unwrap();
        revoke(&db, &first.prefix).await.unwrap();
        let mut conn = db.acquire().await.unwrap();
        let next = replace(&mut conn, first.server_id).await.unwrap().unwrap();
        assert_eq!(next.replaced, None);
    }

    #[sqlx::test]
    async fn the_database_refuses_a_second_active_key(db: PgPool) {
        let first = issue(&db, "Test server").await.unwrap();
        let mut conn = db.acquire().await.unwrap();
        let second = add_key(&mut conn, first.server_id).await;
        assert!(second.is_err());
    }

    #[sqlx::test]
    async fn a_revoked_key_is_rejected(db: PgPool) {
        let issued = issue(&db, "Test server").await.unwrap();

        assert!(revoke(&db, &issued.prefix).await.unwrap());
        assert!(!revoke(&db, &issued.prefix).await.unwrap());
        let status = status_with(db.clone(), Some(&format!("Bearer {}", issued.key))).await;
        assert_eq!(status, 401);
        assert_eq!(
            look_up(&db, &issued.key).await.unwrap(),
            KeyLookup::Revoked {
                server_id: issued.server_id
            }
        );
    }

    #[test]
    fn keys_are_random_and_only_their_hash_is_kept() {
        let (a, b) = (generate(), generate());
        assert_ne!(a, b);
        assert!(a[KEY_TAG.len()..].chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(hash(&a), hash(&b));
    }
}
