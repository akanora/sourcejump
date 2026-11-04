//! Community policy the plugin doesn't need, kept as versioned data in `policies`: each known policy's name
//! and the shape of its value. Staff publish new versions (`staff/rules.rs`); the newest version is in force.
//!
//! The values are the community's decisions. The checks here are only about shape and sense (a count is
//! positive), never about what the value should be.

use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, types::Json as JsonColumn};
use utoipa::ToSchema;

use crate::replays::ReplayPolicy;

/// A policy and its value, as stored: the name picks the shape of the value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "name", content = "value", rename_all = "snake_case")]
pub enum Policy {
    /// How long a listed server counts as online, and stays on the list, after its last heartbeat.
    Servers(ServersPolicy),
    /// Which runs' replays SourceJump asks servers for.
    Replays(ReplayPolicy),
    /// How many tiers maps are rated in.
    Tiers(TiersPolicy),
    /// How a personal best earns points (`leaderboards.rs`).
    Points(PointsPolicy),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ServersPolicy {
    /// Online: heard from within this many minutes. 1 to 1440.
    pub online_minutes: i32,
    /// Listed servers silent for longer leave the list until they return. 1 to 8760.
    pub listed_hours: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TiersPolicy {
    /// 1 to 100.
    pub count: i16,
}

/// What a personal best is worth: a map is worth `base` at tier 1 and `growth_percent` of the tier below at each
/// tier up; a bonus `bonus_percent` of that at its own tier. Finishing earns `finish_percent` of the value, and
/// the rest is earned by speed, as `(world record ÷ time) ^ speed_exponent`. Whole numbers, so policies compare.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PointsPolicy {
    /// 1 to 100000.
    pub base: i32,
    /// 100 to 1000: 200 doubles the value each tier.
    pub growth_percent: i32,
    /// 0 to 100.
    pub finish_percent: i32,
    /// 1 to 20.
    pub speed_exponent: i32,
    /// 0 to 100.
    pub bonus_percent: i32,
}

impl PointsPolicy {
    /// Used until the community publishes a formula, and shown as a draft (lead, 2026-10-26).
    pub const DRAFT: Self = Self {
        base: 50,
        growth_percent: 200,
        finish_percent: 50,
        speed_exponent: 4,
        bonus_percent: 25,
    };
}

impl Policy {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Servers(_) => "servers",
            Self::Replays(_) => "replays",
            Self::Tiers(_) => "tiers",
            Self::Points(_) => "points",
        }
    }

    /// Whether the value makes sense at all; what it should be is the community's call.
    pub fn check(&self) -> Result<(), String> {
        match self {
            Self::Servers(value) => {
                if !(1..=1440).contains(&value.online_minutes) {
                    return Err("online_minutes is 1 to 1440".to_owned());
                }
                if !(1..=8760).contains(&value.listed_hours) {
                    return Err("listed_hours is 1 to 8760".to_owned());
                }
            }
            Self::Replays(_) => {}
            Self::Tiers(value) => {
                if !(1..=100).contains(&value.count) {
                    return Err("the tier count is 1 to 100".to_owned());
                }
            }
            Self::Points(value) => {
                let ranges = [
                    ("base", value.base, 1..=100_000),
                    ("growth_percent", value.growth_percent, 100..=1000),
                    ("finish_percent", value.finish_percent, 0..=100),
                    ("speed_exponent", value.speed_exponent, 1..=20),
                    ("bonus_percent", value.bonus_percent, 0..=100),
                ];
                for (name, value, range) in ranges {
                    if !range.contains(&value) {
                        return Err(format!("{name} is {} to {}", range.start(), range.end()));
                    }
                }
            }
        }
        Ok(())
    }

    /// Reads a stored row back into its type. None for a name or value this API doesn't know.
    pub fn from_row(name: &str, value: &serde_json::Value) -> Option<Self> {
        serde_json::from_value(serde_json::json!({ "name": name, "value": value })).ok()
    }

    fn value(&self) -> serde_json::Value {
        let tagged = serde_json::to_value(self).expect("a policy always serializes");
        tagged["value"].clone()
    }
}

/// The version in force for `name`, if any has been published.
pub async fn current_version(
    conn: &mut PgConnection,
    name: &str,
) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar!("SELECT max(version) FROM policies WHERE name = $1", name)
        .fetch_one(conn)
        .await
}

/// Publishes `policy` as its next version and returns that version. Check it first.
pub async fn publish(conn: &mut PgConnection, policy: &Policy) -> Result<i32, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO policies (name, version, value)
        SELECT $1, coalesce(max(version), 0) + 1, $2 FROM policies WHERE name = $1
        RETURNING version
        "#,
        policy.name(),
        JsonColumn(policy.value()) as _
    )
    .fetch_one(conn)
    .await
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::*;
    use crate::replays::ReplayRequest;

    #[test]
    fn stored_values_keep_their_shape() {
        let replays = Policy::from_row("replays", &json!({ "request": "new_personal_best" }));
        assert_eq!(
            replays,
            Some(Policy::Replays(ReplayPolicy {
                request: ReplayRequest::NewPersonalBest,
                public_styles: Vec::new(),
            }))
        );
        let servers = Policy::Servers(ServersPolicy {
            online_minutes: 25,
            listed_hours: 24,
        });
        assert_eq!(
            servers.value(),
            json!({ "online_minutes": 25, "listed_hours": 24 })
        );
        assert_eq!(Policy::from_row("points", &json!({})), None);
        let draft = Policy::Points(PointsPolicy::DRAFT);
        assert_eq!(Policy::from_row("points", &draft.value()), Some(draft));
    }

    #[test]
    fn nonsense_values_are_refused() {
        assert!(Policy::Tiers(TiersPolicy { count: 0 }).check().is_err());
        let servers = Policy::Servers(ServersPolicy {
            online_minutes: 0,
            listed_hours: 24,
        });
        assert!(servers.check().is_err());
        assert!(Policy::Tiers(TiersPolicy { count: 6 }).check().is_ok());
        assert!(Policy::Points(PointsPolicy::DRAFT).check().is_ok());
        let flat = PointsPolicy {
            growth_percent: 50,
            ..PointsPolicy::DRAFT
        };
        assert!(Policy::Points(flat).check().is_err());
    }

    #[sqlx::test]
    async fn publishing_adds_the_next_version(db: PgPool) {
        let mut conn = db.acquire().await.unwrap();
        // The schema publishes servers v1 and replays v1.
        let policy = Policy::Servers(ServersPolicy {
            online_minutes: 30,
            listed_hours: 48,
        });
        assert_eq!(publish(&mut conn, &policy).await.unwrap(), 2);
        assert_eq!(current_version(&mut conn, "tiers").await.unwrap(), None);
        let tiers = Policy::Tiers(TiersPolicy { count: 5 });
        assert_eq!(publish(&mut conn, &tiers).await.unwrap(), 1);
    }
}
