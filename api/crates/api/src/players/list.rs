//! Finding players, `GET /v1/players`: by name or Steam ID, or the most recently active when no search is given.
//! Searches also find players SourceJump knows only from legacy records, by their name on the old site.

use axum::{
    Json,
    extract::{Query, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::SteamId64;
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    name_search,
};

const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 100;

#[derive(Debug, Deserialize, IntoParams)]
pub struct PlayersQuery {
    /// Part of a name, or a Steam ID in any form. Leave out for recently active players. Names that are
    /// exactly the search come first, then names starting with it, then names containing it; near misses
    /// for a typo come last, closest first.
    q: Option<String>,
    /// 1 to 100. Default 20.
    limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerList {
    pub players: Vec<PlayerSummary>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerSummary {
    /// SteamID64, as a string.
    pub steamid64: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub country_code: Option<String>,
    /// When their latest run finished. None for a player with no runs.
    pub last_run_at: Option<DateTime<Utc>>,
}

/// Players matching a search, most recently active first; or, with no search, players with runs in the last
/// 30 days.
#[utoipa::path(
    get,
    path = "/v1/players",
    tag = "players",
    params(PlayersQuery),
    responses(
        (status = OK, body = PlayerList),
        (status = UNPROCESSABLE_ENTITY, description = "Search too short, or limit out of range", body = ErrorBody),
    ),
)]
pub async fn list_players(
    State(state): State<AppState>,
    Query(query): Query<PlayersQuery>,
) -> Result<Json<PlayerList>, ApiError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(ApiError::Invalid(format!(
            "limit must be between 1 and {MAX_LIMIT}"
        )));
    }
    let search = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty());

    let players = match search {
        None => recently_active(&state, limit).await?,
        Some(q) => match SteamId64::parse_any(q) {
            Some(steamid64) => by_steamid(&state, steamid64).await?,
            None if q.chars().count() < 2 => {
                return Err(ApiError::Invalid(
                    "search for at least 2 characters".to_owned(),
                ));
            }
            None => by_name(&state, q, limit).await?,
        },
    };
    Ok(Json(PlayerList { players }))
}

async fn recently_active(state: &AppState, limit: i64) -> Result<Vec<PlayerSummary>, sqlx::Error> {
    sqlx::query_as!(
        PlayerSummary,
        r#"
        SELECT p.steamid64::text AS "steamid64!", p.name AS "name!", p.avatar_url, p.country_code,
               recent.last_run_at AS "last_run_at?"
        FROM (
            SELECT player_steamid64, max(finished_at) AS last_run_at
            FROM runs WHERE finished_at > now() - interval '30 days' AND invalidated_at IS NULL
            GROUP BY player_steamid64
            ORDER BY last_run_at DESC
            LIMIT $1
        ) recent
        JOIN players p ON p.steamid64 = recent.player_steamid64
        ORDER BY recent.last_run_at DESC
        "#,
        limit
    )
    .fetch_all(&state.db)
    .await
}

async fn by_steamid(
    state: &AppState,
    steamid64: SteamId64,
) -> Result<Vec<PlayerSummary>, sqlx::Error> {
    sqlx::query_as!(
        PlayerSummary,
        r#"
        SELECT p.steamid64::text AS "steamid64!", p.name AS "name!", p.avatar_url, p.country_code,
               (SELECT max(finished_at) FROM runs
                WHERE player_steamid64 = p.steamid64 AND invalidated_at IS NULL) AS last_run_at
        FROM players p WHERE p.steamid64 = $1
        UNION ALL
        SELECT lp.steamid64::text, lp.name, lp.avatar_url, lp.country_code, NULL
        FROM legacy_players lp
        WHERE lp.steamid64 = $1 AND NOT EXISTS (SELECT 1 FROM players WHERE steamid64 = $1)
        "#,
        steamid64.get()
    )
    .fetch_all(&state.db)
    .await
}

async fn by_name(state: &AppState, q: &str, limit: i64) -> Result<Vec<PlayerSummary>, sqlx::Error> {
    let pattern = name_search::contains_pattern(q);
    let mut tx = name_search::begin(&state.db).await?;
    let players = sqlx::query_as!(
        PlayerSummary,
        r#"
        SELECT steamid64::text AS "steamid64!", name AS "name!", avatar_url, country_code, last_run_at
        FROM (
            SELECT p.steamid64, p.name, p.avatar_url, p.country_code, (SELECT max(finished_at) FROM runs
                          WHERE player_steamid64 = p.steamid64 AND invalidated_at IS NULL) AS last_run_at
            FROM players p WHERE p.name ILIKE $1 ESCAPE '\' OR $4 <% p.name
            UNION ALL
            SELECT lp.steamid64, lp.name, lp.avatar_url, lp.country_code, NULL
            FROM legacy_players lp
            WHERE (lp.name ILIKE $1 ESCAPE '\' OR $4 <% lp.name)
              AND NOT EXISTS (SELECT 1 FROM players WHERE steamid64 = lp.steamid64)
        ) matches
        -- The closest names first: exactly the search, then starting with it, then containing it, then near
        -- misses by closeness; within each, whoever played last.
        ORDER BY CASE WHEN lower(name) = lower($3) THEN 0 WHEN starts_with(lower(name), lower($3)) THEN 1
                      WHEN name ILIKE $1 ESCAPE '\' THEN 2 ELSE 3 END,
                 CASE WHEN name NOT ILIKE $1 ESCAPE '\' THEN word_similarity($4, name) END DESC NULLS LAST,
                 last_run_at DESC NULLS LAST, name
        LIMIT $2
        "#,
        pattern,
        limit,
        q,
        name_search::near_miss_term(q)
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(players)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::PgPool;

    use super::*;
    use crate::{
        runs::tests::{run, setup},
        test_client,
    };

    async fn names(db: &PgPool, path: &str) -> Vec<String> {
        let list: PlayerList = test_client::get(db, path).await.json();
        list.players.into_iter().map(|p| p.name).collect()
    }

    #[sqlx::test]
    async fn finds_players_by_name_or_steamid(db: PgPool) {
        let key = setup(&db).await;
        let mut other = run("b", 20.0);
        other["player"] = json!({ "steamid64": "76561197960287931", "name": "50%_off" });
        for body in [&run("a", 30.0), &other] {
            test_client::post(&db, "/v1/runs", Some(&key), body).await;
        }

        assert_eq!(names(&db, "/v1/players?q=GAB").await, ["gabe"]);
        assert_eq!(names(&db, "/v1/players?q=%25_").await, ["50%_off"]);
        assert_eq!(names(&db, "/v1/players?q=__").await, Vec::<String>::new());
        assert_eq!(names(&db, "/v1/players?q=%5BU:1:22202%5D").await, ["gabe"]);
        assert_eq!(test_client::get(&db, "/v1/players?q=g").await.status, 422);
    }

    #[sqlx::test]
    async fn exact_names_come_before_more_recent_players(db: PgPool) {
        let key = setup(&db).await;
        let mut later = run("b", 20.0);
        later["player"] = json!({ "steamid64": "76561197960287931", "name": "xgabe" });
        later["finished_at"] = json!(1_797_700_000);
        for body in [&run("a", 30.0), &later] {
            test_client::post(&db, "/v1/runs", Some(&key), body).await;
        }

        assert_eq!(names(&db, "/v1/players?q=Gabe").await, ["gabe", "xgabe"]);
        // A near miss comes last, and only when it's close.
        let mut cat = run("c", 25.0);
        cat["player"] = json!({ "steamid64": "76561197960287932", "name": "strafe_cat" });
        test_client::post(&db, "/v1/runs", Some(&key), &cat).await;
        assert_eq!(names(&db, "/v1/players?q=strafecat").await, ["strafe_cat"]);
        assert_eq!(names(&db, "/v1/players?q=zzz").await, Vec::<String>::new());
    }

    #[sqlx::test]
    async fn lists_recently_active_players_without_a_search(db: PgPool) {
        let key = setup(&db).await;
        test_client::post(&db, "/v1/runs", Some(&key), &run("a", 30.0)).await;

        assert_eq!(names(&db, "/v1/players").await, ["gabe"]);
        assert_eq!(
            test_client::get(&db, "/v1/players?limit=0").await.status,
            422
        );
    }
}
