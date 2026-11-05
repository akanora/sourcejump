//! Game servers: their API keys, the heartbeat each server sends on map start and every few minutes, and
//! the list of servers the site shows.

mod activity;
pub mod heartbeat;
pub mod heartbeat_limit;
pub mod keys;
pub mod list;
pub mod listing;

use chrono::{DateTime, TimeDelta, Utc};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::app::AppState;

pub fn routes() -> OpenApiRouter<AppState> {
    heartbeat::routes()
        .routes(routes!(list::list_servers))
        .routes(routes!(activity::server_activity))
}

/// How far ahead of our clock a server's clock may run. Beyond that the time is wrong or made up, and it
/// would win every "newest" comparison: a player's name, Activity order, a map's last run.
const MAX_CLOCK_AHEAD: TimeDelta = TimeDelta::minutes(5);

/// Reads a time a game server reports (`finished_at`, `detected_at`), in Unix seconds by its clock.
pub fn server_time(field: &str, unix: i64, now: DateTime<Utc>) -> Result<DateTime<Utc>, String> {
    let at = DateTime::from_timestamp(unix, 0)
        .ok_or_else(|| format!("{field} is not a valid Unix time"))?;
    if at > now + MAX_CLOCK_AHEAD {
        return Err(format!(
            "{field} is in the future; check the server's clock"
        ));
    }
    Ok(at)
}
