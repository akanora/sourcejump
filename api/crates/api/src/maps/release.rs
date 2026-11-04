//! When a map was released, to the precision staff know it (a year, a month of a year, or a day), and who
//! made it. Staff set both (`staff/maps.rs`); the map's page shows them under its name.

use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

use crate::players::PlayerRef;

/// Before Half-Life there were no bhop maps; an earlier year is a typo.
const FIRST_YEAR: i16 = 1990;

/// A year, optionally its month, and optionally that month's day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReleaseDate {
    pub year: i16,
    /// 1 to 12; none when only the year is known.
    pub month: Option<i16>,
    /// 1 to 31; none when only the month is known. Only with a month.
    pub day: Option<i16>,
}

impl ReleaseDate {
    /// From the `maps.released_*` columns: none without a year.
    pub fn from_columns(year: Option<i16>, month: Option<i16>, day: Option<i16>) -> Option<Self> {
        Some(Self {
            year: year?,
            month,
            day,
        })
    }

    /// Refuses a day without its month, a date that doesn't exist, and one that starts after today.
    pub fn check(self) -> Result<(), String> {
        if self.year < FIRST_YEAR {
            return Err(format!("the year is {FIRST_YEAR} or later"));
        }
        if self.day.is_some() && self.month.is_none() {
            return Err("a day needs its month".to_owned());
        }
        let part = |value: Option<i16>| u32::try_from(value.unwrap_or(1)).ok();
        let first_day = part(self.month)
            .zip(part(self.day))
            .and_then(|(month, day)| NaiveDate::from_ymd_opt(self.year.into(), month, day))
            .ok_or_else(|| "that date doesn't exist".to_owned())?;
        if first_day > Utc::now().date_naive() {
            return Err("the release can't be in the future".to_owned());
        }
        Ok(())
    }
}

/// A map's release date and mapper, each none when unknown.
pub struct Release {
    pub date: Option<ReleaseDate>,
    pub mapper: Option<PlayerRef>,
}

impl Release {
    pub async fn of_map(db: &PgPool, map_id: i64) -> Result<Self, sqlx::Error> {
        let row = sqlx::query!(
            r#"
            SELECT m.released_year, m.released_month, m.released_day,
                   p.steamid64::text AS "mapper_steamid64?", p.name AS "mapper_name?",
                   p.avatar_url AS mapper_avatar_url, p.country_code AS mapper_country_code
            FROM maps m LEFT JOIN players p ON p.steamid64 = m.mapper_steamid64
            WHERE m.id = $1
            "#,
            map_id
        )
        .fetch_one(db)
        .await?;
        Ok(Self {
            date: ReleaseDate::from_columns(
                row.released_year,
                row.released_month,
                row.released_day,
            ),
            mapper: PlayerRef::joined(
                row.mapper_steamid64,
                row.mapper_name,
                row.mapper_avatar_url,
                row.mapper_country_code,
            ),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::ReleaseDate;

    fn date(year: i16, month: Option<i16>, day: Option<i16>) -> Result<(), String> {
        ReleaseDate { year, month, day }.check()
    }

    #[test]
    fn takes_a_year_a_month_or_a_day_that_has_passed() {
        assert!(date(2012, None, None).is_ok());
        assert!(date(2012, Some(2), None).is_ok());
        assert!(date(2012, Some(2), Some(29)).is_ok());
        assert!(date(2013, Some(2), Some(29)).is_err(), "not a leap year");
        assert!(
            date(2012, None, Some(5)).is_err(),
            "a day without its month"
        );
        assert!(date(2012, Some(13), None).is_err());
        assert!(date(1989, None, None).is_err());
        assert!(date(2999, None, None).is_err());
    }
}
