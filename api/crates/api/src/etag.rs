//! Conditional GETs for answers game servers re-read on every map change: an `ETag` on each, and a bodiless
//! `304` when `If-None-Match` names the answer the client already has.
//!
//! The tag is a hash of the body, so it changes exactly when the answer does, with nothing to keep in step.
//! The query still runs; what's saved is the transfer and the server's parsing, which is what the plugin
//! pays for.

use std::fmt::Write;

use axum::{
    body::{Body, to_bytes},
    extract::Request,
    http::{HeaderValue, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use sha2::{Digest, Sha256};

/// Answers are held in memory to hash them. The tagged ones are a few hundred kilobytes at most; anything
/// past this is a bug, answered as one.
const MAX_TAGGED_BYTES: usize = 4 * 1024 * 1024;

/// Middleware: tags successful answers and answers `304` to a matching `If-None-Match`.
pub async fn conditional(request: Request, next: Next) -> Response {
    let known = request.headers().get(header::IF_NONE_MATCH).cloned();
    let response = next.run(request).await;
    if response.status() != StatusCode::OK {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let Ok(bytes) = to_bytes(body, MAX_TAGGED_BYTES).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let tag = tag(&bytes);
    let value = HeaderValue::from_str(&format!("\"{tag}\"")).expect("hex is a valid header value");
    parts.headers.insert(header::ETAG, value);
    if known.is_some_and(|known| matches(&known, &tag)) {
        // The answer's own headers stay, such as the zone set's version: an old set published again has
        // the same body, so the same tag, but a newer version.
        parts.status = StatusCode::NOT_MODIFIED;
        parts.headers.remove(header::CONTENT_TYPE);
        parts.headers.remove(header::CONTENT_LENGTH);
        return Response::from_parts(parts, Body::empty());
    }
    Response::from_parts(parts, Body::from(bytes))
}

/// The first 128 bits of the body's SHA-256, as hex.
fn tag(body: &[u8]) -> String {
    Sha256::digest(body)[..16]
        .iter()
        .fold(String::with_capacity(32), |mut hex, byte| {
            write!(hex, "{byte:02x}").expect("writing to a String can't fail");
            hex
        })
}

/// Whether `If-None-Match` names this tag. Proxies that compress the answer (Caddy, Cloudflare) hand the
/// client a weakened tag (`W/"…"`) or one with the encoding appended (`"…-zstd"`), so those match too.
fn matches(known: &HeaderValue, tag: &str) -> bool {
    let Ok(known) = known.to_str() else {
        return false;
    };
    known.split(',').any(|candidate| {
        let candidate = candidate.trim();
        let candidate = candidate.strip_prefix("W/").unwrap_or(candidate);
        candidate == "*" || candidate.trim_matches('"').starts_with(tag)
    })
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::matches;

    #[test]
    fn matches_tags_as_proxies_pass_them_back() {
        let tag = "0123456789abcdef0123456789abcdef";
        let matching = |value: &str| matches(&HeaderValue::from_str(value).unwrap(), tag);
        assert!(matching(&format!("\"{tag}\"")));
        assert!(matching(&format!("W/\"{tag}\"")));
        assert!(matching(&format!("\"{tag}-zstd\"")));
        assert!(matching(&format!("\"other\", \"{tag}\"")));
        assert!(matching("*"));
        assert!(!matching("\"0123\""));
    }
}
