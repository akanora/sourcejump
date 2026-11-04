//! Game servers: their API keys, the heartbeat each server sends on map start and every few minutes, and
//! the list of servers the site shows.

mod activity;
pub mod heartbeat;
pub mod keys;
pub mod list;
pub mod listing;

use utoipa_axum::{router::OpenApiRouter, routes};

use crate::app::AppState;

pub fn routes() -> OpenApiRouter<AppState> {
    heartbeat::routes()
        .routes(routes!(list::list_servers))
        .routes(routes!(activity::server_activity))
}
