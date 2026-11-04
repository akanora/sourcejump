//! What a banned player may not do: restriction bits, stored as a bitmap in `bans.restrictions`, and the
//! restrictions a player's active bans add up to.
//!
//! Sensitive path, fails closed. Same rules as privileges: a bit's position is its stored meaning and is never
//! renumbered or reused; bits no restriction defines are ignored when read; outside the database restrictions
//! travel as names.

use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use utoipa::ToSchema;

use super::SteamId64;

/// One restriction. The discriminant is the bit position in `bans.restrictions`.
// The names are what the API sends ("no_records"), so they keep their shared prefix.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Restriction {
    /// Runs are stored invalid: off every board, and no replay is asked for.
    NoRecords = 0,
    /// May not write, change or remove community posts or run comments.
    NoPosting = 1,
    /// May not change their own profile details (`details.rs`); what's there stays until staff change it.
    NoProfileEdits = 2,
}

impl Restriction {
    pub const ALL: [Self; 3] = [Self::NoRecords, Self::NoPosting, Self::NoProfileEdits];

    pub fn bit(self) -> i64 {
        1 << (self as u32)
    }
}

/// A set of restrictions, read from or written to a bitmap column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Restrictions(i64);

impl Restrictions {
    /// Reads a stored bitmap. Bits no restriction defines are dropped.
    pub fn from_bits(bits: i64) -> Self {
        Self(bits & Self::of(&Restriction::ALL).0)
    }

    pub fn of(restrictions: &[Restriction]) -> Self {
        Self(restrictions.iter().fold(0, |bits, r| bits | r.bit()))
    }

    pub fn bits(self) -> i64 {
        self.0
    }

    pub fn contains(self, restriction: Restriction) -> bool {
        self.0 & restriction.bit() != 0
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    pub fn list(self) -> Vec<Restriction> {
        Restriction::ALL
            .into_iter()
            .filter(|&restriction| self.contains(restriction))
            .collect()
    }
}

/// What the player's active bans restrict, together. A ban is active until it's lifted or its end passes;
/// every query for active bans in the API spells out that same condition.
pub async fn active(
    conn: &mut PgConnection,
    player: SteamId64,
) -> Result<Restrictions, sqlx::Error> {
    let bits = sqlx::query_scalar!(
        r#"SELECT coalesce(bit_or(restrictions), 0) AS "bits!" FROM bans
           WHERE player_steamid64 = $1 AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now())"#,
        player.get()
    )
    .fetch_one(conn)
    .await?;
    Ok(Restrictions::from_bits(bits))
}

/// The staff log entry of the newest active ban that keeps this player off the boards, if any. The ingest
/// stores the run invalid in its name.
///
/// Locks the player's row (shared) first: banning takes it exclusively, so a run and a ban arriving together
/// are ordered. Either the ban commits first and this sees it, or the run does and the ban's invalidation of
/// existing runs takes it.
pub async fn records_ban(
    conn: &mut PgConnection,
    player: SteamId64,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query!(
        "SELECT 1 AS locked FROM players WHERE steamid64 = $1 FOR SHARE",
        player.get()
    )
    .fetch_optional(&mut *conn)
    .await?;
    sqlx::query_scalar!(
        r#"SELECT log_id FROM bans
           WHERE player_steamid64 = $1 AND restrictions & $2 <> 0
             AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now())
           ORDER BY banned_at DESC, id DESC LIMIT 1"#,
        player.get(),
        Restriction::NoRecords.bit()
    )
    .fetch_optional(conn)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_bits_restrict_nothing() {
        let read = Restrictions::from_bits(0b1 | 1 << 40);
        assert_eq!(read.list(), [Restriction::NoRecords]);
        assert_eq!(Restrictions::of(&Restriction::ALL).bits(), 0b111);
    }
}
