//! A player's public Steam profile: name, avatar and country, read from `steamcommunity.com/profiles/{id}/?xml=1`.
//!
//! The lead chose this over the Steam Web API, so no Steam key is needed. The XML is Steam's community page in
//! another form; it has no published contract, so anything unexpected leaves our copy as it was.

use std::time::Duration as StdDuration;

use chrono::{Duration, Utc};
use quick_xml::{Reader, escape::unescape, events::Event};
use sqlx::PgPool;

use super::{SteamId64, countries};
use crate::steam::Steam;

/// How long a fetched profile is fresh. Older copies are refreshed when the profile is viewed.
const FRESH_FOR: Duration = Duration::days(1);
/// Steam rate-limits community pages per IP without saying how hard, so fetches keep at least this gap.
const MIN_GAP: StdDuration = StdDuration::from_secs(2);

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SteamProfile {
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub country_code: Option<&'static str>,
}

#[derive(Debug)]
pub enum FetchError {
    Http(reqwest::Error),
    Status(u16),
    /// Steam answered, but not with a profile (no such account, or an error page).
    NotAProfile,
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(error) => write!(f, "request failed: {error}"),
            Self::Status(status) => write!(f, "Steam answered {status}"),
            Self::NotAProfile => f.write_str("Steam's answer isn't a profile"),
        }
    }
}

/// Reads the profile document. Only `<profile>`'s own fields count: groups further down have avatars too.
pub fn parse(xml: &str) -> Result<SteamProfile, FetchError> {
    let mut reader = Reader::from_str(xml);
    let mut profile = SteamProfile::default();
    let mut path: Vec<String> = Vec::new();
    let mut saw_profile = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(tag)) => {
                path.push(tag.name().as_ref().to_owned());
                saw_profile |= path.len() == 1 && path[0] == "profile";
            }
            Ok(Event::End(_)) => {
                path.pop();
            }
            Ok(Event::CData(text)) => {
                read_field(&path, text.into_inner().trim().to_owned(), &mut profile);
            }
            Ok(Event::Text(text)) => {
                if let Ok(text) = unescape(&text.into_inner()) {
                    read_field(&path, text.trim().to_owned(), &mut profile);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => return Err(FetchError::NotAProfile),
        }
    }
    if saw_profile {
        Ok(profile)
    } else {
        Err(FetchError::NotAProfile)
    }
}

fn read_field(path: &[String], text: String, profile: &mut SteamProfile) {
    let [root, field] = path else { return };
    if root != "profile" || text.is_empty() {
        return;
    }
    match field.as_str() {
        "steamID" => profile.name = Some(text),
        "avatarFull" if text.starts_with("https://") => profile.avatar_url = Some(text),
        "location" => profile.country_code = countries::code_for_location(&text),
        _ => {}
    }
}

pub async fn fetch(steam: &Steam, steamid64: SteamId64) -> Result<SteamProfile, FetchError> {
    steam.wait_for_turn(MIN_GAP).await;
    let url = steam
        .community
        .join(&format!("profiles/{steamid64}/?xml=1"))
        .expect("a valid path");
    let response = steam.http.get(url).send().await.map_err(FetchError::Http)?;
    if !response.status().is_success() {
        return Err(FetchError::Status(response.status().as_u16()));
    }
    parse(&response.text().await.map_err(FetchError::Http)?)
}

/// Fetches the profile and stores it. The Steam name is used only while no run has given the player a name:
/// on SourceJump, the name players see is the one they play under.
pub async fn refresh(db: &PgPool, steam: &Steam, steamid64: SteamId64) -> Result<(), sqlx::Error> {
    let profile = match fetch(steam, steamid64).await {
        Ok(profile) => profile,
        Err(error) => {
            tracing::warn!(%steamid64, %error, "couldn't fetch a Steam profile");
            return Ok(());
        }
    };
    sqlx::query!(
        r#"
        UPDATE players SET
            avatar_url = $2,
            -- A country the player picked on their profile stays.
            country_code = CASE WHEN country_chosen THEN country_code ELSE $3 END,
            steam_profile_fetched_at = now(),
            name = CASE WHEN name_seen_at = '-infinity' AND $4::text IS NOT NULL THEN $4 ELSE name END
        WHERE steamid64 = $1
        "#,
        steamid64.get(),
        profile.avatar_url,
        profile.country_code,
        profile.name
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Refreshes the profile in the background if our copy is missing or a day old. The caller doesn't wait:
/// pages show what we have, and the next view shows the update.
pub fn refresh_if_stale(
    db: PgPool,
    steam: Steam,
    steamid64: SteamId64,
    fetched_at: Option<chrono::DateTime<Utc>>,
) {
    if fetched_at.is_some_and(|fetched| Utc::now() - fetched < FRESH_FOR) {
        return;
    }
    tokio::spawn(async move {
        if let Err(error) = refresh(&db, &steam, steamid64).await {
            tracing::error!(%steamid64, %error, "couldn't store a Steam profile");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shaped like Steam's response, with invented values.
    const PUBLIC: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><profile>
        <steamID64>76561197960287930</steamID64>
        <steamID><![CDATA[nova]]></steamID>
        <privacyState>public</privacyState>
        <avatarMedium><![CDATA[https://avatars.example/abc_medium.jpg]]></avatarMedium>
        <avatarFull><![CDATA[https://avatars.example/abc_full.jpg]]></avatarFull>
        <location><![CDATA[Bergen, Hordaland, Norway]]></location>
        <groups><group isPrimary="1">
            <avatarFull><![CDATA[https://avatars.example/group_full.jpg]]></avatarFull>
            <location><![CDATA[Sweden]]></location>
        </group></groups>
    </profile>"#;

    #[test]
    fn reads_name_avatar_and_country() {
        assert_eq!(
            parse(PUBLIC).unwrap(),
            SteamProfile {
                name: Some("nova".to_owned()),
                avatar_url: Some("https://avatars.example/abc_full.jpg".to_owned()),
                country_code: Some("NO"),
            }
        );
    }

    #[test]
    fn a_private_profile_still_has_a_name_and_avatar() {
        let private = r"<profile><steamID><![CDATA[ricochet]]></steamID><privacyState>private</privacyState>
            <avatarFull><![CDATA[https://avatars.example/r_full.jpg]]></avatarFull></profile>";
        let profile = parse(private).unwrap();
        assert_eq!(profile.name.as_deref(), Some("ricochet"));
        assert_eq!(profile.country_code, None);
    }

    #[test]
    fn an_error_page_is_not_a_profile() {
        let missing = "<response><error><![CDATA[The specified profile could not be found.]]></error></response>";
        assert!(matches!(parse(missing), Err(FetchError::NotAProfile)));
        assert!(matches!(parse("<html>busy"), Err(FetchError::NotAProfile)));
    }

    #[test]
    fn avatars_must_be_https() {
        let profile =
            parse(r"<profile><avatarFull>http://avatars.example/a.jpg</avatarFull></profile>")
                .unwrap();
        assert_eq!(profile.avatar_url, None);
    }
}
