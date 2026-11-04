//! Signing in with Steam and out again, and `GET /v1/me` for the signed-in player.
//!
//! These endpoints are for browsers: they answer with redirects and cookies, not JSON. The website links to
//! `/v1/auth/steam`, Steam sends the player back to the callback, and the callback sets the session cookie.

pub mod openid;
pub mod sessions;

use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
    response::Redirect,
};
use axum_extra::extract::cookie::CookieJar;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    players::{self, privileges::Privilege},
};
use openid::{Refusal, ReturnTo};
use sessions::SignedIn;

/// The website's page for a sign-in that didn't complete.
const FAILED_PAGE: &str = "/sign-in/failed";

#[derive(Debug, Deserialize, IntoParams)]
pub struct ReturnQuery {
    /// The page to come back to: a path on this site, such as `/maps`. Anything else means `/`.
    return_to: Option<String>,
}

/// The signed-in player.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Me {
    /// SteamID64, as a string.
    pub steamid64: String,
    pub name: String,
    pub avatar_url: Option<String>,
    /// ISO 3166-1 alpha-2, from the player's Steam profile.
    pub country_code: Option<String>,
    /// Staff privileges. Empty for most players.
    pub privileges: Vec<Privilege>,
}

pub fn routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(start))
        .routes(routes!(callback))
        .routes(routes!(sign_out))
        .routes(routes!(me))
}

/// Sends the browser to Steam to sign in.
#[utoipa::path(
    get,
    path = "/v1/auth/steam",
    tag = "auth",
    params(ReturnQuery),
    responses((status = SEE_OTHER, description = "To Steam's sign-in page")),
)]
async fn start(State(state): State<AppState>, Query(query): Query<ReturnQuery>) -> Redirect {
    let return_to = ReturnTo::new(query.return_to.as_deref());
    Redirect::to(openid::login_url(&state.steam, &state.public_url, &return_to).as_str())
}

/// Where Steam sends the browser back. Starts a session if Steam confirms the sign-in.
#[utoipa::path(
    get,
    path = "/v1/auth/steam/callback",
    tag = "auth",
    responses((
        status = SEE_OTHER,
        description = "Back to the page the player came from, signed in; or to the website's sign-in failure page",
    )),
)]
async fn callback(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(params): Query<Vec<(String, String)>>,
) -> Result<(CookieJar, Redirect), ApiError> {
    let verified = match openid::verify(
        &state.db,
        &state.steam,
        &state.public_url,
        &params,
        Utc::now(),
    )
    .await
    {
        Ok(verified) => verified,
        Err(Refusal::Cancelled) => {
            let requested = params
                .iter()
                .find(|(key, _)| key == "return_to")
                .map(|(_, value)| value.as_str());
            return Ok((jar, Redirect::to(ReturnTo::new(requested).as_str())));
        }
        Err(refusal) => {
            tracing::warn!(?refusal, "refused a Steam sign-in");
            return Ok((jar, Redirect::to(FAILED_PAGE)));
        }
    };

    players::ensure_exists(&state.db, verified.steamid64).await?;
    // Always fresh at sign-in, so a player who just changed their avatar or country sees it.
    players::steam_profile::refresh_if_stale(
        state.db.clone(),
        state.steam.clone(),
        verified.steamid64,
        None,
    );
    let token = sessions::create(&state.db, verified.steamid64).await?;
    tracing::info!(steamid64 = %verified.steamid64, "signed in");
    Ok((
        jar.add(sessions::session_cookie(token)),
        Redirect::to(verified.return_to.as_str()),
    ))
}

/// Ends the session. A form on the website posts here.
#[utoipa::path(
    post,
    path = "/v1/auth/sign-out",
    tag = "auth",
    params(ReturnQuery),
    responses(
        (status = SEE_OTHER, description = "Back to the page the player came from, signed out"),
        (status = FORBIDDEN, description = "Not sent from SourceJump's own pages", body = ErrorBody),
    ),
)]
async fn sign_out(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
    Query(query): Query<ReturnQuery>,
) -> Result<(CookieJar, Redirect), ApiError> {
    sessions::require_same_origin(&headers, &state.public_url)?;
    if let Some(cookie) = jar.get(sessions::COOKIE) {
        sessions::end(&state.db, cookie.value()).await?;
    }
    let return_to = ReturnTo::new(query.return_to.as_deref());
    Ok((
        jar.remove(sessions::removal_cookie()),
        Redirect::to(return_to.as_str()),
    ))
}

/// The signed-in player, from the session cookie.
#[utoipa::path(
    get,
    path = "/v1/me",
    tag = "auth",
    responses(
        (status = OK, body = Me),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
    ),
)]
async fn me(State(state): State<AppState>, signed_in: SignedIn) -> Result<Json<Me>, ApiError> {
    let player = sqlx::query!(
        "SELECT name, avatar_url, country_code FROM players WHERE steamid64 = $1",
        signed_in.steamid64.get()
    )
    .fetch_one(&state.db)
    .await?;
    Ok(Json(Me {
        steamid64: signed_in.steamid64.to_string(),
        name: player.name,
        avatar_url: player.avatar_url,
        country_code: player.country_code,
        privileges: signed_in.privileges.list(),
    }))
}

#[cfg(test)]
mod tests {
    use axum::{
        Form, Router,
        body::Body,
        http::{Request, header},
        routing::post,
    };
    use sqlx::PgPool;
    use url::Url;

    use super::*;
    use crate::{
        steam::Steam,
        test_client::{self, TestResponse},
    };

    /// A stand-in for Steam's `OpenID` endpoint that answers every check with `is_valid`.
    async fn fake_steam(is_valid: bool) -> Steam {
        let app = Router::new().route(
            "/openid/login",
            post(move |Form(form): Form<Vec<(String, String)>>| async move {
                let mode = form.iter().find(|(key, _)| key == "openid.mode");
                assert_eq!(mode.map(|(_, v)| v.as_str()), Some("check_authentication"));
                format!("ns:http://specs.openid.net/auth/2.0\nis_valid:{is_valid}\n")
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Steam::with_base(&Url::parse(&format!("http://{address}/")).unwrap())
    }

    fn state(db: &PgPool, steam: Steam) -> AppState {
        AppState {
            steam,
            public_url: openid::tests::public_url(),
            ..AppState::for_tests(db.clone())
        }
    }

    async fn sign_in(state: &AppState) -> TestResponse {
        let params = openid::tests::assertion(&state.steam, Utc::now());
        let query = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(&params)
            .finish();
        let request = Request::get(format!("/v1/auth/steam/callback?{query}"))
            .body(Body::empty())
            .unwrap();
        test_client::send_to(state.clone(), request).await
    }

    fn session_from(response: &TestResponse) -> String {
        let set_cookie = response.headers[header::SET_COOKIE].to_str().unwrap();
        assert!(set_cookie.contains("HttpOnly") && set_cookie.contains("Secure"));
        assert!(set_cookie.contains("SameSite=Lax"));
        set_cookie
            .split(';')
            .next()
            .unwrap()
            .strip_prefix("sj_session=")
            .unwrap()
            .to_owned()
    }

    async fn me_with(state: &AppState, token: &str) -> TestResponse {
        let request = Request::get("/v1/me")
            .header(header::COOKIE, format!("sj_session={token}"))
            .body(Body::empty())
            .unwrap();
        test_client::send_to(state.clone(), request).await
    }

    #[sqlx::test]
    async fn signing_in_starts_a_session(db: PgPool) {
        let state = state(&db, fake_steam(true).await);

        let response = sign_in(&state).await;
        assert_eq!(response.status, 303);
        assert_eq!(response.headers[header::LOCATION], "/maps/bhop_forest");

        let me = me_with(&state, &session_from(&response)).await;
        assert_eq!(me.status, 200);
        let me: Me = me.json();
        assert_eq!(me.steamid64, openid::tests::PLAYER);
        assert_eq!(me.privileges, []);
    }

    #[sqlx::test]
    async fn a_replayed_sign_in_is_refused(db: PgPool) {
        let state = state(&db, fake_steam(true).await);
        let params = openid::tests::assertion(&state.steam, Utc::now());
        let query = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(&params)
            .finish();
        let send = || {
            test_client::send_to(
                state.clone(),
                Request::get(format!("/v1/auth/steam/callback?{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
        };

        assert_eq!(send().await.headers[header::LOCATION], "/maps/bhop_forest");
        let replay = send().await;
        assert_eq!(replay.headers[header::LOCATION], FAILED_PAGE);
        assert!(replay.headers.get(header::SET_COOKIE).is_none());
    }

    #[sqlx::test]
    async fn a_sign_in_steam_doesnt_confirm_is_refused(db: PgPool) {
        let state = state(&db, fake_steam(false).await);

        let response = sign_in(&state).await;
        assert_eq!(response.headers[header::LOCATION], FAILED_PAGE);
        assert!(response.headers.get(header::SET_COOKIE).is_none());
    }

    #[sqlx::test]
    async fn me_needs_a_live_session(db: PgPool) {
        let state = state(&db, Steam::new());
        assert_eq!(me_with(&state, "not-a-session").await.status, 401);
        let anonymous =
            test_client::send_to(state, Request::get("/v1/me").body(Body::empty()).unwrap()).await;
        assert_eq!(anonymous.status, 401);
        assert!(anonymous.headers.get(header::WWW_AUTHENTICATE).is_none());
    }

    #[sqlx::test]
    async fn signing_out_ends_the_session_only_from_our_pages(db: PgPool) {
        let state = state(&db, fake_steam(true).await);
        let token = session_from(&sign_in(&state).await);
        let sign_out = |origin: &'static str| {
            test_client::send_to(
                state.clone(),
                Request::post("/v1/auth/sign-out?return_to=/maps")
                    .header(header::COOKIE, format!("sj_session={token}"))
                    .header(header::ORIGIN, origin)
                    .body(Body::empty())
                    .unwrap(),
            )
        };

        assert_eq!(sign_out("https://evil.example").await.status, 403);
        assert_eq!(me_with(&state, &token).await.status, 200);

        let response = sign_out("https://sourcejump.test").await;
        assert_eq!(response.status, 303);
        assert_eq!(response.headers[header::LOCATION], "/maps");
        assert_eq!(me_with(&state, &token).await.status, 401);
    }

    #[sqlx::test]
    async fn start_sends_the_browser_to_steam(db: PgPool) {
        let response = test_client::get(&db, "/v1/auth/steam?return_to=//evil.example").await;
        assert_eq!(response.status, 303);
        let location = response.headers[header::LOCATION].to_str().unwrap();
        assert!(
            location.starts_with("http://127.0.0.1:9/openid/login?"),
            "{location}"
        );
        assert!(
            location.contains("callback%3Freturn_to%3D%252F&"),
            "{location}"
        );
    }
}
