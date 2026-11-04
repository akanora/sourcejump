//! Video posts link to YouTube (lead, 2026-10-20). A link is reduced to its video ID, so any form of it
//! (watch page, youtu.be, shorts, with or without tracking parameters) is stored and shown the same way.

use url::Url;

/// The video ID from a YouTube link, or None if it isn't one.
pub fn video_id(link: &str) -> Option<String> {
    let url = Url::parse(link.trim()).ok()?;
    if !matches!(url.scheme(), "https" | "http") {
        return None;
    }
    let host = url.host_str()?;
    let mut segments = url.path_segments()?;
    let id = match host {
        "youtu.be" => segments.next()?.to_owned(),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" => match segments.next()? {
            "watch" => url
                .query_pairs()
                .find(|(key, _)| key == "v")
                .map(|(_, value)| value.into_owned())?,
            "shorts" | "live" | "embed" => segments.next()?.to_owned(),
            _ => return None,
        },
        _ => return None,
    };
    let valid = id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    valid.then_some(id)
}

/// The link the site shows for a video.
pub fn watch_url(video_id: &str) -> String {
    format!("https://www.youtube.com/watch?v={video_id}")
}

#[cfg(test)]
mod tests {
    use super::video_id;

    #[test]
    fn reads_every_common_link_form() {
        for link in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42",
            "https://youtu.be/dQw4w9WgXcQ?si=tracking",
            "https://m.youtube.com/shorts/dQw4w9WgXcQ",
            " https://www.youtube.com/live/dQw4w9WgXcQ ",
        ] {
            assert_eq!(video_id(link).as_deref(), Some("dQw4w9WgXcQ"), "{link}");
        }
    }

    #[test]
    fn refuses_anything_else() {
        for link in [
            "https://vimeo.com/123",
            "https://www.youtube.com/channel/UCabc",
            "https://www.youtube.com/watch?v=short",
            "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
            "javascript:alert(1)",
            "not a link",
        ] {
            assert_eq!(video_id(link), None, "{link}");
        }
    }
}
