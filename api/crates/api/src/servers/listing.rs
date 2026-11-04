//! Which servers the site lists: a whitelist of addresses kept by staff, separate from keys, so nobody can
//! fill the list by starting servers or changing IPs (lead, 2026-10-20). Staff change it through
//! `staff/servers.rs`, which logs each change.

use std::net::SocketAddr;

use chrono::{DateTime, Utc};
use sqlx::{PgExecutor, PgPool};

use crate::players::SteamId64;

/// Lists the server at `address`. It doesn't have to have sent a heartbeat yet. Says whether it's new.
/// `listed_by` is None from the command line.
pub async fn list(
    db: impl PgExecutor<'_>,
    address: SocketAddr,
    listed_by: Option<SteamId64>,
) -> Result<bool, sqlx::Error> {
    let added = sqlx::query!(
        "INSERT INTO server_listings (ip, port, listed_by) VALUES ($1::inet, $2, $3) ON CONFLICT DO NOTHING",
        address.ip().to_string() as _,
        i32::from(address.port()),
        listed_by.map(SteamId64::get)
    )
    .execute(db)
    .await?;
    Ok(added.rows_affected() == 1)
}

/// Takes the server at `address` off the list. Says whether it was listed.
pub async fn unlist(db: impl PgExecutor<'_>, address: SocketAddr) -> Result<bool, sqlx::Error> {
    let removed = sqlx::query!(
        "DELETE FROM server_listings WHERE ip = $1::inet AND port = $2",
        address.ip().to_string() as _,
        i32::from(address.port())
    )
    .execute(db)
    .await?;
    Ok(removed.rows_affected() == 1)
}

/// A server that has sent a heartbeat, for staff deciding what to list.
pub struct SeenServer {
    pub address: String,
    pub hostname: String,
    /// The IP the server says it has, when it differs from where its heartbeats come from.
    pub reported_ip: Option<String>,
    pub players: i32,
    pub keyed: bool,
    pub listed: bool,
    pub last_seen_at: DateTime<Utc>,
}

/// Every server that has sent a heartbeat, most recently heard first.
pub async fn seen(db: &PgPool) -> Result<Vec<SeenServer>, sqlx::Error> {
    sqlx::query_as!(
        SeenServer,
        r#"
        SELECT host(h.ip) || ':' || h.port AS "address!",
               h.report->>'hostname' AS "hostname!",
               NULLIF(h.report->>'ip', host(h.ip)) AS reported_ip,
               (h.report->>'players')::int AS "players!",
               h.server_id IS NOT NULL AS "keyed!",
               l.ip IS NOT NULL AS "listed!",
               h.received_at AS last_seen_at
        FROM server_heartbeats h
        LEFT JOIN server_listings l ON l.ip = h.ip AND l.port = h.port
        ORDER BY h.received_at DESC
        "#
    )
    .fetch_all(db)
    .await
}
