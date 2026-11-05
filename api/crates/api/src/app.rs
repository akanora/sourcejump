//! Assembles the HTTP router and the OpenAPI spec from each feature's routes.
//!
//! Routes and their documentation are registered together, so the spec can't drift from what is served.
//! The spec is committed as `api/openapi.json`; the web client is generated from it.

use axum::Router;
use sqlx::PgPool;
use utoipa::{
    Modify, OpenApi,
    openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
};
use utoipa_axum::router::OpenApiRouter;

use url::Url;

use crate::{
    record_events::stream::Wake,
    replays::download::DownloadSlots,
    servers::heartbeat_limit::HeartbeatLimit,
    steam::Steam,
    storage::{Staging, Storage},
};

#[derive(Clone)]
pub struct AppState {
    /// The request pool, with the statement time limit (`query_time_limit.rs`).
    pub db: PgPool,
    pub storage: Storage,
    /// Where staff uploads wait to be checked.
    pub staging: Staging,
    pub steam: Steam,
    /// Where players reach the site, such as `https://sourcejump.net/`. Sign-in redirects and same-origin
    /// checks are built from it.
    pub public_url: Url,
    /// Wakes open record streams when events commit (`record_events/stream.rs`).
    pub record_events: Wake,
    /// Places for replay downloads in progress (`replays/download.rs`).
    pub replay_downloads: DownloadSlots,
    pub heartbeat_limit: HeartbeatLimit,
}

#[cfg(test)]
impl AppState {
    pub fn for_tests(db: PgPool) -> Self {
        Self {
            db,
            storage: Storage::for_tests(),
            staging: Staging::for_tests(),
            // Port 9 refuses connections, so a test can't reach the real Steam by accident.
            steam: Steam::with_base(&Url::parse("http://127.0.0.1:9/").expect("a valid URL")),
            public_url: Url::parse("https://sourcejump.test/").expect("a valid URL"),
            // Its sender is dropped, so a stream ends after its first read. Stream tests make their own.
            record_events: tokio::sync::watch::channel(()).1,
            replay_downloads: DownloadSlots::new(),
            heartbeat_limit: HeartbeatLimit::default(),
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "SourceJump API",
        description = "Global records for the Counter-Strike: Source bunnyhop community."
    ),
    modifiers(&ServerKeyScheme)
)]
struct ApiDoc;

/// Declares the `server_key` scheme that keyed endpoints refer to.
struct ServerKeyScheme;

impl Modify for ServerKeyScheme {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let scheme = HttpBuilder::new()
            .scheme(HttpAuthScheme::Bearer)
            .description(Some("The API key SourceJump issued to this game server."))
            .build();
        openapi
            .components
            .get_or_insert_with(Default::default)
            .add_security_scheme("server_key", SecurityScheme::Http(scheme));
    }
}

fn routes() -> OpenApiRouter<AppState> {
    let mut doc = ApiDoc::openapi();
    // utoipa copies the license from Cargo.toml, which names none while the repo is private.
    doc.info.license = None;
    OpenApiRouter::with_openapi(doc)
        .merge(crate::health::routes())
        .merge(crate::ruleset::routes())
        .merge(crate::servers::routes())
        .merge(crate::plugin_releases::routes())
        .merge(crate::runs::routes())
        .merge(crate::legacy::routes())
        .merge(crate::daily_totals::routes())
        .merge(crate::replays::routes())
        .merge(crate::records::routes())
        .merge(crate::record_events::routes())
        .merge(crate::maps::routes())
        .merge(crate::leaderboards::routes())
        .merge(crate::zones::routes())
        .merge(crate::anticheat::routes())
        .merge(crate::posts::routes())
        .merge(crate::auth::routes())
        .merge(crate::players::routes())
        .merge(crate::staff::routes())
}

pub fn router(state: AppState) -> Router {
    let (router, _) = routes().split_for_parts();
    router.with_state(state)
}

pub fn openapi() -> utoipa::openapi::OpenApi {
    routes().into_openapi()
}

#[cfg(test)]
mod tests {
    #[test]
    fn committed_openapi_json_matches_the_code() {
        let committed = include_str!("../../../openapi.json");
        let generated = super::openapi().to_pretty_json().unwrap();
        assert!(
            committed.trim_end() == generated,
            "api/openapi.json is out of date: run `just openapi`"
        );
    }
}
