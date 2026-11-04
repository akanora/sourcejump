//! The API's error responses: one JSON shape for every error, with internal details logged instead of sent.

use axum::{
    Json,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub enum ApiError {
    /// Missing, unknown or revoked API key. The message never echoes the key.
    Unauthorized(&'static str),
    /// The endpoint is for signed-in players, and the request has no live session.
    SignInRequired,
    /// Signed in, or otherwise identified, but not allowed to do this.
    Forbidden(&'static str),
    NotFound(&'static str),
    /// The request was based on data that has changed since, such as a ruleset version someone else replaced.
    Conflict(&'static str),
    /// Too soon after the last request of its kind; it may work a little later.
    TooManyRequests(&'static str),
    /// The request body couldn't be read as the expected JSON. Keeps the status axum chose (400, 415 or 422).
    Malformed(StatusCode, String),
    /// The request is well-formed but breaks a rule, so sending it again will never succeed.
    Invalid(String),
    Internal(Box<dyn std::error::Error + Send + Sync>),
}

/// The body of every error response.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ErrorBody {
    /// What went wrong, for a person to read. Not meant for matching in code.
    pub error: String,
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(error.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let signs_in = matches!(self, Self::SignInRequired);
        let (status, message) = match self {
            Self::Unauthorized(message) => (StatusCode::UNAUTHORIZED, message.to_owned()),
            Self::SignInRequired => (StatusCode::UNAUTHORIZED, "sign in first".to_owned()),
            Self::Forbidden(message) => (StatusCode::FORBIDDEN, message.to_owned()),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message.to_owned()),
            Self::Conflict(message) => (StatusCode::CONFLICT, message.to_owned()),
            Self::TooManyRequests(message) => (StatusCode::TOO_MANY_REQUESTS, message.to_owned()),
            Self::Malformed(status, message) => (status, message),
            Self::Invalid(message) => (StatusCode::UNPROCESSABLE_ENTITY, message),
            Self::Internal(error) => {
                tracing::error!(%error, "request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal error".to_owned(),
                )
            }
        };
        let body = ErrorBody { error: message };
        let mut response = (status, Json(body)).into_response();
        // Only API keys are bearer tokens; a missing session is answered by signing in, not by a header.
        if status == StatusCode::UNAUTHORIZED && !signs_in {
            response
                .headers_mut()
                .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
        }
        response
    }
}
