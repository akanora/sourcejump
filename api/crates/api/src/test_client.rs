//! Sends requests through the full router in tests, the same way a game server or the website would.

use std::net::SocketAddr;

use axum::{
    body::{Body, Bytes},
    extract::ConnectInfo,
    http::{HeaderMap, Request},
};
use http_body_util::BodyExt;
use serde::de::DeserializeOwned;
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

use crate::app;

pub struct TestResponse {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: Bytes,
}

impl TestResponse {
    pub fn json<T: DeserializeOwned>(&self) -> T {
        serde_json::from_slice(&self.body).unwrap_or_else(|error| {
            panic!(
                "response isn't the expected JSON ({error}): {}",
                String::from_utf8_lossy(&self.body)
            )
        })
    }
}

pub async fn get(db: &PgPool, path: &str) -> TestResponse {
    send(db, Request::get(path).body(Body::empty()).unwrap()).await
}

/// POSTs `body` as JSON, with `key` as the bearer token when given.
pub async fn post(db: &PgPool, path: &str, key: Option<&str>, body: &Value) -> TestResponse {
    let mut request = Request::post(path).header("content-type", "application/json");
    if let Some(key) = key {
        request = request.header("authorization", format!("Bearer {key}"));
    }
    send(db, request.body(Body::from(body.to_string())).unwrap()).await
}

pub async fn send(db: &PgPool, request: Request<Body>) -> TestResponse {
    send_to(app::AppState::for_tests(db.clone()), request).await
}

/// Sends through a router built on `state`, for tests that need a stand-in Steam or other settings.
pub async fn send_to(state: app::AppState, mut request: Request<Body>) -> TestResponse {
    // As if through Caddy on this machine, so an `X-Forwarded-For` header in a test sets the client address.
    if request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .is_none()
    {
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40_000))));
    }
    let response = app::router(state).oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    TestResponse {
        status,
        headers,
        body,
    }
}
