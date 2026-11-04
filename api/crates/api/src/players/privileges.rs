//! What a player may do beyond playing: staff privileges, stored as a bitmap in `players.privileges`.
//!
//! Sensitive path, fails closed. A bit's position is its stored meaning, so a privilege keeps its number for
//! good: never renumber or reuse one, only add new ones. Bits that no privilege defines are ignored when read.
//! Outside the database, privileges travel as names (`"manage_bans"`), never as numbers, so no client copies
//! the bit layout.

use serde::{Deserialize, Serialize};
#[cfg(test)]
use sqlx::PgExecutor;
use utoipa::ToSchema;

#[cfg(test)]
use super::SteamId64;

/// One staff privilege. The discriminant is the bit position in `players.privileges`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Privilege {
    /// Grant and revoke privileges and restrictions.
    ManagePrivileges = 0,
    // Bit 1 was `manage_ruleset`, retired when rules moved to code (lead, 2026-10-21). Never reuse it: a
    // stored bit 1 is ignored when read.
    /// Issue and revoke server API keys.
    ManageKeys = 2,
    /// Review and publish zones.
    ManageZones = 3,
    /// Edit maps: the ranked pool and tiers.
    ManageMaps = 4,
    /// Ban and unban players.
    ManageBans = 5,
    /// Mark runs invalid, or valid again.
    InvalidateRuns = 6,
    /// Read and act on anti-cheat detections.
    ReviewAnticheat = 7,
    /// Write community posts and edit or remove one's own.
    PostCommunity = 8,
    /// Edit or hide anyone's community posts.
    ManagePosts = 9,
    /// List and unlist servers, and see every server's heartbeat.
    ManageServers = 10,
}

impl Privilege {
    pub const ALL: [Self; 10] = [
        Self::ManagePrivileges,
        Self::ManageKeys,
        Self::ManageZones,
        Self::ManageMaps,
        Self::ManageBans,
        Self::InvalidateRuns,
        Self::ReviewAnticheat,
        Self::PostCommunity,
        Self::ManagePosts,
        Self::ManageServers,
    ];

    fn bit(self) -> i64 {
        1 << (self as u32)
    }

    /// The name the API and the CLI use, e.g. `manage_bans`.
    pub fn name(self) -> &'static str {
        match self {
            Self::ManagePrivileges => "manage_privileges",
            Self::ManageKeys => "manage_keys",
            Self::ManageZones => "manage_zones",
            Self::ManageMaps => "manage_maps",
            Self::ManageBans => "manage_bans",
            Self::InvalidateRuns => "invalidate_runs",
            Self::ReviewAnticheat => "review_anticheat",
            Self::PostCommunity => "post_community",
            Self::ManagePosts => "manage_posts",
            Self::ManageServers => "manage_servers",
        }
    }

    /// Whether this privilege makes its holder staff, with access to the staff area. Posting is a community
    /// role, not a staff one.
    pub fn is_staff(self) -> bool {
        self != Self::PostCommunity
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|privilege| privilege.name() == name)
    }
}

/// A set of privileges, read from or written to the bitmap column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Privileges(i64);

impl Privileges {
    /// Reads a stored bitmap. Bits no privilege defines are dropped, so a stray bit grants nothing.
    pub fn from_bits(bits: i64) -> Self {
        Self(bits & Self::of(&Privilege::ALL).0)
    }

    pub fn of(privileges: &[Privilege]) -> Self {
        Self(privileges.iter().fold(0, |bits, p| bits | p.bit()))
    }

    pub fn bits(self) -> i64 {
        self.0
    }

    pub fn contains(self, privilege: Privilege) -> bool {
        self.0 & privilege.bit() != 0
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// Those in `self` that `other` doesn't hold.
    pub fn without(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }

    /// Those in both.
    pub fn and(self, other: Self) -> Self {
        Self(self.0 & other.0)
    }

    pub fn list(self) -> Vec<Privilege> {
        Privilege::ALL
            .into_iter()
            .filter(|&privilege| self.contains(privilege))
            .collect()
    }
}

/// Adds privileges to a player and returns what they now hold, for tests to set up staff. Staff and the CLI
/// change privileges with `staff::privileges::change`, which checks and logs it.
#[cfg(test)]
pub async fn grant(
    db: impl PgExecutor<'_>,
    steamid64: SteamId64,
    privileges: Privileges,
) -> Result<Privileges, sqlx::Error> {
    let bits = sqlx::query_scalar!(
        r#"
        INSERT INTO players (steamid64, name, name_seen_at, privileges) VALUES ($1::bigint, $1::bigint::text, '-infinity', $2)
        ON CONFLICT (steamid64) DO UPDATE SET privileges = players.privileges | excluded.privileges
        RETURNING privileges
        "#,
        steamid64.get(),
        privileges.bits()
    )
    .fetch_one(db)
    .await?;
    Ok(Privileges::from_bits(bits))
}

/// Removes privileges from a player and returns what they still hold, or None for a player we don't know.
/// For tests, like `grant`.
#[cfg(test)]
pub async fn revoke(
    db: impl PgExecutor<'_>,
    steamid64: SteamId64,
    privileges: Privileges,
) -> Result<Option<Privileges>, sqlx::Error> {
    let bits = sqlx::query_scalar!(
        "UPDATE players SET privileges = privileges & ~$2::bigint WHERE steamid64 = $1 RETURNING privileges",
        steamid64.get(),
        privileges.bits()
    )
    .fetch_optional(db)
    .await?;
    Ok(bits.map(Privileges::from_bits))
}

#[cfg(test)]
mod tests {
    use sqlx::PgPool;

    use super::*;

    fn player() -> SteamId64 {
        SteamId64::try_from("76561197960287930".to_owned()).unwrap()
    }

    #[test]
    fn bits_never_move() {
        // Stored bitmaps depend on these positions. Changing one silently hands out other privileges.
        let positions: Vec<(&str, i64)> = Privilege::ALL
            .into_iter()
            .map(|p| (p.name(), p.bit()))
            .collect();
        assert_eq!(
            positions,
            [
                ("manage_privileges", 1),
                ("manage_keys", 4),
                ("manage_zones", 8),
                ("manage_maps", 16),
                ("manage_bans", 32),
                ("invalidate_runs", 64),
                ("review_anticheat", 128),
                ("post_community", 256),
                ("manage_posts", 512),
                ("manage_servers", 1024),
            ]
        );
        // The retired manage_ruleset bit grants nothing.
        assert!(Privileges::from_bits(2).is_empty());
    }

    #[test]
    fn names_match_the_api() {
        for privilege in Privilege::ALL {
            let json = serde_json::to_value(privilege).unwrap();
            assert_eq!(json, privilege.name());
            assert_eq!(Privilege::from_name(privilege.name()), Some(privilege));
        }
        assert_eq!(Privilege::from_name("admin"), None);
    }

    #[test]
    fn undefined_bits_grant_nothing() {
        let read = Privileges::from_bits(i64::MIN | 1 << 40 | Privilege::ManageBans.bit());
        assert_eq!(read.list(), [Privilege::ManageBans]);
    }

    #[sqlx::test]
    async fn grant_and_revoke(db: PgPool) {
        let bans = Privileges::of(&[Privilege::ManageBans]);
        let keys = Privileges::of(&[Privilege::ManageKeys]);

        assert_eq!(grant(&db, player(), bans).await.unwrap(), bans);
        let both = grant(&db, player(), keys).await.unwrap();
        assert_eq!(both.list(), [Privilege::ManageKeys, Privilege::ManageBans]);
        assert_eq!(revoke(&db, player(), bans).await.unwrap(), Some(keys));
    }

    #[sqlx::test]
    async fn revoking_from_an_unknown_player_changes_nothing(db: PgPool) {
        let bans = Privileges::of(&[Privilege::ManageBans]);
        assert_eq!(revoke(&db, player(), bans).await.unwrap(), None);
    }
}
