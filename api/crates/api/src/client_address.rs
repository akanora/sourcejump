//! The IP address a request came from, and the country it's in, for endpoints that identify a game server by
//! them.
//!
//! In production the API listens on localhost behind Caddy, which sets `X-Forwarded-For` to the client's
//! address and passes on Cloudflare's `CF-IPCountry` (`deploy/Caddyfile`). Those headers are trusted only when
//! the connection itself comes from this machine; anyone connecting directly could write anything in them.

use std::net::{IpAddr, SocketAddr};

use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::request::Parts,
};

use crate::{app::AppState, error::ApiError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientAddress(pub IpAddr);

impl ClientAddress {
    /// The address limits count by: IPv4 whole, IPv6 by its /64, the block one customer usually gets, so
    /// rotating through it doesn't help.
    pub fn block(self) -> IpAddr {
        match self.0 {
            IpAddr::V4(_) => self.0,
            IpAddr::V6(v6) => IpAddr::V6((u128::from(v6) & !u128::from(u64::MAX)).into()),
        }
    }
}

impl FromRequestParts<AppState> for ClientAddress {
    type Rejection = ApiError;

    fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> impl Future<Output = Result<Self, Self::Rejection>> {
        std::future::ready(client_ip(parts).map(Self))
    }
}

/// The country Cloudflare placed the client's IP in, as an ISO 3166-1 alpha-2 code. None when the request
/// didn't come through Cloudflare, or Cloudflare didn't know (it sends `XX`, and `T1` for Tor).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientCountry(pub Option<String>);

impl FromRequestParts<AppState> for ClientCountry {
    type Rejection = ApiError;

    fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> impl Future<Output = Result<Self, Self::Rejection>> {
        std::future::ready(client_country(parts).map(Self))
    }
}

fn client_country(parts: &Parts) -> Result<Option<String>, ApiError> {
    if !peer(parts)?.ip().is_loopback() {
        return Ok(None);
    }
    let code = parts
        .headers
        .get("cf-ipcountry")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|code| {
            code.len() == 2 && code.bytes().all(|b| b.is_ascii_uppercase()) && *code != "XX"
        });
    // T1 is Tor, not a country.
    Ok(code.filter(|code| *code != "T1").map(str::to_owned))
}

fn peer(parts: &Parts) -> Result<SocketAddr, ApiError> {
    let ConnectInfo(peer) = parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .copied()
        .ok_or_else(|| ApiError::Internal("the server wasn't started with connect info".into()))?;
    Ok(peer)
}

fn client_ip(parts: &Parts) -> Result<IpAddr, ApiError> {
    let peer = peer(parts)?;
    if !peer.ip().is_loopback() {
        return Ok(peer.ip());
    }
    // The last entry is the one the nearest proxy, Caddy, added; earlier ones came from the client.
    let forwarded = parts
        .headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .next_back()
        .and_then(|last| last.trim().parse().ok());
    Ok(forwarded.unwrap_or(peer.ip()))
}

#[cfg(test)]
mod tests {
    use axum::{Router, body::Body, extract::ConnectInfo, http::Request, routing::get};
    use sqlx::PgPool;
    use tower::ServiceExt;

    use super::*;

    async fn address(db: PgPool, peer: &str, forwarded: Option<&str>) -> String {
        let app = Router::new()
            .route(
                "/",
                get(|ClientAddress(ip): ClientAddress| async move { ip.to_string() }),
            )
            .with_state(AppState::for_tests(db));
        let mut request = Request::get("/");
        if let Some(value) = forwarded {
            request = request.header("x-forwarded-for", value);
        }
        respond(app, request, peer).await
    }

    async fn country(db: PgPool, peer: &str, header: Option<&str>) -> String {
        let app = Router::new()
            .route(
                "/",
                get(|ClientCountry(code): ClientCountry| async move {
                    code.unwrap_or_else(|| "none".to_owned())
                }),
            )
            .with_state(AppState::for_tests(db));
        let mut request = Request::get("/");
        if let Some(value) = header {
            request = request.header("cf-ipcountry", value);
        }
        respond(app, request, peer).await
    }

    async fn respond(app: Router, request: axum::http::request::Builder, peer: &str) -> String {
        let mut request = request.body(Body::empty()).unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
        let response = app.oneshot(request).await.unwrap();
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        String::from_utf8(body.to_vec()).unwrap()
    }

    #[sqlx::test]
    async fn trusts_the_forwarded_address_only_from_this_machine(db: PgPool) {
        let behind_caddy = address(db.clone(), "127.0.0.1:5000", Some("1.2.3.4, 5.6.7.8")).await;
        assert_eq!(behind_caddy, "5.6.7.8");
        let direct = address(db.clone(), "9.9.9.9:5000", Some("5.6.7.8")).await;
        assert_eq!(direct, "9.9.9.9");
        let local = address(db.clone(), "127.0.0.1:5000", None).await;
        assert_eq!(local, "127.0.0.1");
        let garbage = address(db, "127.0.0.1:5000", Some("not an ip")).await;
        assert_eq!(garbage, "127.0.0.1");
    }

    #[sqlx::test]
    async fn trusts_the_country_only_from_this_machine(db: PgPool) {
        assert_eq!(
            country(db.clone(), "127.0.0.1:5000", Some("SE")).await,
            "SE"
        );
        assert_eq!(
            country(db.clone(), "9.9.9.9:5000", Some("SE")).await,
            "none"
        );
        assert_eq!(country(db.clone(), "127.0.0.1:5000", None).await, "none");
        for unknown in ["XX", "T1", "se", "SWE"] {
            assert_eq!(
                country(db.clone(), "127.0.0.1:5000", Some(unknown)).await,
                "none"
            );
        }
    }
}
