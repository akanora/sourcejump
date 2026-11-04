//! Map tiers: a difficulty per map and track, out of the tier count in the `tiers` policy.
//!
//! Both the count and each map's tier are community decisions that staff record, so the API serves a tier
//! only once staff have published a count (the `tiers` policy, `policies.rs`).

/// The tier count in force, or `None` while the community hasn't decided one.
pub async fn tier_count(db: impl sqlx::PgExecutor<'_>) -> Result<Option<i16>, sqlx::Error> {
    let count = sqlx::query_scalar!(
        r#"SELECT (value->>'count')::smallint AS count FROM policies WHERE name = 'tiers' ORDER BY version DESC LIMIT 1"#
    )
    .fetch_optional(db)
    .await?;
    Ok(count.flatten())
}
