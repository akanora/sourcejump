//! The ruleset: the versioned rules every server applies on map start, served publicly at `GET /v1/ruleset`.
//!
//! The section list follows the plugin blueprint. The values are community policy kept as data in the
//! `rulesets` table; nothing here decides them.

use std::collections::BTreeMap;

use axum::{Json, extract::State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, types::Json as JsonColumn};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
};

/// A published ruleset. Published versions never change; new rules get a new version.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Ruleset {
    /// Sent with every run, so each run is judged by the rules it was played under.
    pub version: i32,
    pub published_at: DateTime<Utc>,
    #[serde(flatten)]
    pub document: RulesetDocument,
}

/// Everything in a ruleset except its version; stored as the `rulesets.document` column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RulesetDocument {
    pub plugin: PluginRequirement,
    /// Cvar name → required value. The plugin sets these and re-sets them if they change.
    pub cvars: BTreeMap<String, String>,
    pub plugins: PluginRules,
    /// The ranked styles. A server style is submitted only if it matches one of these exactly.
    pub styles: Vec<RankedStyle>,
    pub zones: ZoneRules,
    /// Switches for optional plugin behaviour.
    pub features: BTreeMap<String, bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PluginRequirement {
    /// The oldest `sourcejump.smx` version allowed to submit runs.
    pub min_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PluginRules {
    pub required: Vec<RequiredPlugin>,
    /// Any match blocks submissions.
    pub forbidden: Vec<ForbiddenPlugin>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RequiredPlugin {
    pub name: String,
    /// Accepted versions. Empty means any version is accepted.
    pub versions: Vec<String>,
}

/// Matches a loaded plugin by name, by file hash, or by both.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ForbiddenPlugin {
    pub name: Option<String>,
    pub file_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RankedStyle {
    /// SourceJump's style key, the only style identifier runs carry (never a server's style number).
    pub key: String,
    pub name: String,
    /// What the plugin does differently on this style, beyond shavit's settings. Versions published before
    /// 2026-11-04 have none.
    #[serde(default)]
    pub flags: Vec<StyleFlag>,
    /// shavit style setting → required value, as written in shavit's styles config. Numbers compare as
    /// numbers, and a setting the server's config leaves out counts as shavit's default.
    pub settings: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum StyleFlag {
    /// The plugin's landfix doesn't lift jumps on this style.
    Nolandfix,
    /// The plugin syncs the player's strafes, as `shavit-syncstyle` did on its own.
    Autosync,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ZoneRules {
    /// Where `shavit-zones-json` loads a map's zones from.
    pub source_url: String,
    /// Zone types SourceJump controls; the server's other zone sources are turned off for these.
    pub controlled_types: Vec<String>,
}

impl RulesetDocument {
    /// Whether servers could apply this document as written. What the rules should be is the community's
    /// call; this only refuses what the plugin would misread, such as two styles with one key. Rulesets ship
    /// as migrations (lead, 2026-10-21), so a test runs this over every version they publish.
    #[cfg(test)]
    pub fn check(&self) -> Result<(), String> {
        let version = &self.plugin.min_version;
        if version.is_empty()
            || version.len() > 32
            || !version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".+-".contains(&b))
        {
            return Err("the minimum plugin version is a version like 1.2.0".to_owned());
        }
        for (name, value) in &self.cvars {
            if !token(name, 64) {
                return Err(format!("{name:?} isn't a cvar name"));
            }
            if value.chars().count() > 128 || value.chars().any(char::is_control) {
                return Err(format!(
                    "the value of {name} is too long or has control characters"
                ));
            }
        }
        let mut required = std::collections::HashSet::new();
        for plugin in &self.plugins.required {
            if !plain(&plugin.name, 64) || !required.insert(plugin.name.as_str()) {
                return Err(format!(
                    "required plugin {:?} is empty, too long or listed twice",
                    plugin.name
                ));
            }
            if plugin.versions.iter().any(|v| !plain(v, 32)) {
                return Err(format!(
                    "a version of required plugin {} is empty or too long",
                    plugin.name
                ));
            }
        }
        for plugin in &self.plugins.forbidden {
            let name_ok = plugin.name.as_deref().is_none_or(|name| plain(name, 64));
            let hash_ok = plugin
                .file_hash
                .as_deref()
                .is_none_or(|hash| hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()));
            if (plugin.name.is_none() && plugin.file_hash.is_none()) || !name_ok || !hash_ok {
                return Err("a forbidden plugin needs a name, a SHA-256 file hash (64 hex characters), or both".to_owned());
            }
        }
        let mut keys = std::collections::HashSet::new();
        for style in &self.styles {
            style.check()?;
            if !keys.insert(style.key.as_str()) {
                return Err(format!("two styles have the key {}", style.key));
            }
        }
        let url = url::Url::parse(&self.zones.source_url).ok();
        if !url.is_some_and(|url| matches!(url.scheme(), "http" | "https")) {
            return Err("the zone source is a web address".to_owned());
        }
        if let Some(kind) = self
            .zones
            .controlled_types
            .iter()
            .find(|kind| !token(kind, 32))
        {
            return Err(format!("{kind:?} isn't a zone type name"));
        }
        if let Some(name) = self.features.keys().find(|name| !token(name, 64)) {
            return Err(format!("{name:?} isn't a feature name"));
        }
        Ok(())
    }
}

impl RankedStyle {
    #[cfg(test)]
    fn check(&self) -> Result<(), String> {
        // Keys go into URLs and stored runs, so they stay plain: like `w-only` or `hsw`.
        let key_ok = !self.key.is_empty()
            && self.key.len() <= 32
            && self
                .key
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-');
        if !key_ok {
            return Err(format!(
                "style key {:?} isn't lowercase letters, digits, _ and -",
                self.key
            ));
        }
        if !plain(&self.name, 32) {
            return Err(format!(
                "style {} needs a name of up to 32 characters",
                self.key
            ));
        }
        if self.settings.keys().any(|setting| !token(setting, 64)) {
            return Err(format!(
                "style {} has a setting name that isn't letters, digits and _",
                self.key
            ));
        }
        if self
            .settings
            .values()
            .any(|value| value.parse::<f64>().is_err())
        {
            return Err(format!(
                "style {} has a setting that isn't a number",
                self.key
            ));
        }
        if (1..self.flags.len()).any(|i| self.flags[..i].contains(&self.flags[i])) {
            return Err(format!("style {} lists a flag twice", self.key));
        }
        Ok(())
    }
}

/// A name the plugin uses as-is, such as a cvar or a shavit setting.
#[cfg(test)]
fn token(text: &str, max: usize) -> bool {
    !text.is_empty()
        && text.len() <= max
        && text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Text people read, such as a style's name.
#[cfg(test)]
fn plain(text: &str, max: usize) -> bool {
    !text.trim().is_empty() && text.chars().count() <= max && !text.chars().any(char::is_control)
}

pub fn routes() -> OpenApiRouter<AppState> {
    // Servers read the ruleset on every map change; it changes only with a migration.
    OpenApiRouter::new()
        .routes(routes!(get_ruleset))
        .layer(axum::middleware::from_fn(crate::etag::conditional))
}

/// The current ruleset.
#[utoipa::path(
    get,
    path = "/v1/ruleset",
    tag = "ruleset",
    responses(
        (status = OK, body = Ruleset),
        (status = NOT_FOUND, description = "No ruleset has been published yet", body = ErrorBody),
    ),
)]
async fn get_ruleset(State(state): State<AppState>) -> Result<Json<Ruleset>, ApiError> {
    current(&state.db)
        .await?
        .map(Json)
        .ok_or(ApiError::NotFound("no ruleset has been published yet"))
}

async fn current(db: &PgPool) -> Result<Option<Ruleset>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT version, published_at, document AS "document: JsonColumn<RulesetDocument>"
        FROM rulesets
        ORDER BY version DESC
        LIMIT 1
        "#
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|row| Ruleset {
        version: row.version,
        published_at: row.published_at,
        document: row.document.0,
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::{Ruleset, RulesetDocument};
    use crate::{error::ErrorBody, test_client};

    #[sqlx::test]
    async fn every_ruleset_the_migrations_publish_passes_its_checks(db: PgPool) {
        let documents: Vec<(i32, Value)> =
            sqlx::query_as("SELECT version, document FROM rulesets ORDER BY version")
                .fetch_all(&db)
                .await
                .unwrap();
        for (version, document) in documents {
            let document: RulesetDocument = serde_json::from_value(document)
                .unwrap_or_else(|error| panic!("ruleset {version} doesn't parse: {error}"));
            if let Err(problem) = document.check() {
                panic!("ruleset {version}: {problem}");
            }
        }
    }

    #[test]
    fn a_ruleset_with_two_styles_of_one_key_is_refused() {
        let mut document = document("0.1.0");
        let style = json!({ "key": "normal", "name": "Normal", "settings": {} });
        document["styles"] = json!([style, style]);
        let document: RulesetDocument = serde_json::from_value(document).unwrap();
        assert!(document.check().is_err());
        let mut fixed = document.clone();
        fixed.styles.pop();
        assert_eq!(fixed.check(), Ok(()));
    }

    #[test]
    fn styles_without_flags_parse_and_unknown_flags_are_refused() {
        let plain: RulesetDocument = serde_json::from_value(document("0.1.0")).unwrap();
        assert_eq!(plain.styles[0].flags, []);

        let mut flagged = document("0.1.0");
        flagged["styles"][0]["flags"] = json!(["nolandfix"]);
        let flagged: RulesetDocument = serde_json::from_value(flagged).unwrap();
        assert_eq!(flagged.styles[0].flags, [super::StyleFlag::Nolandfix]);

        let mut unknown = document("0.1.0");
        unknown["styles"][0]["flags"] = json!(["nofun"]);
        assert!(serde_json::from_value::<RulesetDocument>(unknown).is_err());
    }

    fn document(min_plugin_version: &str) -> Value {
        json!({
            "plugin": { "min_version": min_plugin_version },
            "cvars": { "sv_cheats": "0" },
            "plugins": { "required": [{ "name": "shavit", "versions": [] }], "forbidden": [] },
            "styles": [{ "key": "normal", "name": "Normal", "settings": {} }],
            "zones": { "source_url": "http://localhost/zones", "controlled_types": ["start", "end"] },
            "features": {},
        })
    }

    async fn publish(db: &PgPool, version: i32, document: Value) {
        sqlx::query("INSERT INTO rulesets (version, document) VALUES ($1, $2)")
            .bind(version)
            .bind(document)
            .execute(db)
            .await
            .unwrap();
    }

    #[sqlx::test]
    async fn serves_the_highest_published_version(db: PgPool) {
        publish(&db, 1, document("1.0.0")).await;
        publish(&db, 2, document("1.1.0")).await;

        let response = test_client::get(&db, "/v1/ruleset").await;

        assert_eq!(response.status, 200);
        let ruleset: Ruleset = response.json();
        assert_eq!(ruleset.version, 2);
        assert_eq!(ruleset.document.plugin.min_version, "1.1.0");
        assert_eq!(ruleset.document.styles[0].key, "normal");
    }

    #[sqlx::test]
    async fn answers_not_found_before_any_ruleset_is_published(db: PgPool) {
        let response = test_client::get(&db, "/v1/ruleset").await;

        assert_eq!(response.status, 404);
        let error: ErrorBody = response.json();
        assert_eq!(error.error, "no ruleset has been published yet");
    }

    #[sqlx::test]
    async fn published_versions_cannot_be_changed_or_deleted(db: PgPool) {
        publish(&db, 1, document("1.0.0")).await;

        let update = sqlx::query("UPDATE rulesets SET document = $1 WHERE version = 1")
            .bind(document("9.9.9"))
            .execute(&db)
            .await;
        let delete = sqlx::query("DELETE FROM rulesets WHERE version = 1")
            .execute(&db)
            .await;

        assert!(update.is_err(), "a published ruleset was changed");
        assert!(delete.is_err(), "a published ruleset was deleted");
    }
}
