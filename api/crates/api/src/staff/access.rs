//! The `Staff` extractor: who may use the `/v1/staff/` routes.
//!
//! Sensitive path, fails closed. A request needs a live session from a player holding at least one staff
//! privilege, and each handler then names the privilege its action needs with `Staff::require`. Anything other
//! than a read must also come from our own pages; that's checked here, so no staff write can forget it.

use axum::{
    extract::FromRequestParts,
    http::{Method, request::Parts},
};

use crate::{
    app::AppState,
    auth::sessions::{SignedIn, require_same_origin},
    error::ApiError,
    players::{
        SteamId64,
        privileges::{Privilege, Privileges},
    },
};

/// A request from a signed-in staff member.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Staff {
    pub steamid64: SteamId64,
    pub privileges: Privileges,
}

impl Staff {
    /// Refuses unless this staff member holds `privilege`.
    pub fn require(&self, privilege: Privilege) -> Result<(), ApiError> {
        if self.privileges.contains(privilege) {
            Ok(())
        } else {
            Err(ApiError::Forbidden(
                "your staff privileges don't cover this",
            ))
        }
    }
}

impl Staff {
    /// Refuses unless this staff member holds at least one of `privileges`.
    pub fn require_any(&self, privileges: &[Privilege]) -> Result<(), ApiError> {
        if privileges.iter().any(|&p| self.privileges.contains(p)) {
            Ok(())
        } else {
            Err(ApiError::Forbidden(
                "your staff privileges don't cover this",
            ))
        }
    }
}

impl FromRequestParts<AppState> for Staff {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let me = SignedIn::from_request_parts(parts, state).await?;
        if !me.privileges.list().into_iter().any(Privilege::is_staff) {
            return Err(ApiError::Forbidden("this is for SourceJump staff"));
        }
        if parts.method != Method::GET && parts.method != Method::HEAD {
            require_same_origin(&parts.headers, &state.public_url)?;
        }
        Ok(Self {
            steamid64: me.steamid64,
            privileges: me.privileges,
        })
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        routing::get,
    };
    use sqlx::PgPool;
    use tower::ServiceExt;

    use super::*;
    use crate::{auth::sessions, players::privileges};

    const PLAYER: &str = "76561197960287930";
    const OTHER: &str = "76561197960287931";

    /// A route that needs `manage_bans`, answering 204 when let through.
    fn guarded(db: &PgPool) -> Router {
        async fn handler(staff: Staff) -> Result<StatusCode, ApiError> {
            staff.require(Privilege::ManageBans)?;
            Ok(StatusCode::NO_CONTENT)
        }
        Router::new()
            .route("/", get(handler).post(handler))
            .with_state(AppState::for_tests(db.clone()))
    }

    async fn session(db: &PgPool, steamid: &str, held: &[Privilege]) -> String {
        let steamid64 = SteamId64::parse_any(steamid).unwrap();
        privileges::grant(db, steamid64, Privileges::of(held))
            .await
            .unwrap();
        sessions::create(db, steamid64).await.unwrap()
    }

    async fn status(db: &PgPool, method: Method, token: Option<&str>, origin: bool) -> u16 {
        let mut request = Request::builder().method(method).uri("/");
        if let Some(token) = token {
            request = request.header("cookie", format!("{}={token}", sessions::COOKIE));
        }
        if origin {
            request = request.header("origin", "https://sourcejump.test");
        }
        let response = guarded(db)
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        response.status().as_u16()
    }

    #[sqlx::test]
    async fn needs_a_session(db: PgPool) {
        assert_eq!(status(&db, Method::GET, None, true).await, 401);
    }

    #[sqlx::test]
    async fn posting_alone_isnt_staff(db: PgPool) {
        let token = session(&db, PLAYER, &[Privilege::PostCommunity]).await;
        assert_eq!(status(&db, Method::GET, Some(&token), true).await, 403);
    }

    #[sqlx::test]
    async fn staff_need_the_routes_own_privilege(db: PgPool) {
        let keys = session(&db, OTHER, &[Privilege::ManageKeys]).await;
        assert_eq!(status(&db, Method::GET, Some(&keys), true).await, 403);
        let bans = session(&db, PLAYER, &[Privilege::ManageBans]).await;
        assert_eq!(status(&db, Method::GET, Some(&bans), true).await, 204);
    }

    #[sqlx::test]
    async fn writes_need_our_origin_and_reads_dont(db: PgPool) {
        let token = session(&db, PLAYER, &[Privilege::ManageBans]).await;
        assert_eq!(status(&db, Method::POST, Some(&token), false).await, 403);
        assert_eq!(status(&db, Method::POST, Some(&token), true).await, 204);
        assert_eq!(status(&db, Method::GET, Some(&token), false).await, 204);
    }
}
