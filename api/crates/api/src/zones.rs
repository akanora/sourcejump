//! Map zones, `GET /v1/maps/{map}/zones`, served in exactly the format shavit-zones-json loads, so the plugin
//! only has to point `shavit_zones_json_url` here.
//!
//! The format follows `shavit-zones-json.sp` in shavit's bhoptimer (master, October 2026). Staff publish zone
//! sets through `staff/maps.rs` (the web, or `sourcejump-api zones import`); `folder.rs` seeds many maps at once.

use axum::{
    Json,
    extract::{Path, State},
};
use serde::{Deserialize, Serialize};
use sqlx::types::Json as JsonColumn;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

pub mod folder;

use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    maps::MapName,
};

/// Zone types shavit-zones-json understands. It skips any other type silently, so an import rejects them.
const ZONE_TYPES: [&str; 18] = [
    "start",
    "end",
    "respawn",
    "stop",
    "slay",
    "freestyle",
    "customspeedlimit",
    "teleport",
    "customspawn",
    "easybhop",
    "slide",
    "airaccel",
    "stage",
    "notimergravity",
    "gravity",
    "speedmod",
    "nojump",
    "autobhop",
];

/// shavit's last bonus track (`Track_Bonus_Last`): the main track is 0, and bonuses run from 1 to 8.
const LAST_TRACK: i32 = 8;
/// shavit holds at most this many zones on a map (`MAX_ZONES`).
const MAX_ZONES: usize = 128;
/// Response header naming the version of the zone set served.
const ZONE_SET_VERSION: &str = "sourcejump-zone-set-version";

/// One zone as shavit-zones-json reads it. Optional fields are left out when unset, as shavit's own dump does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Zone {
    #[serde(rename = "type")]
    pub kind: String,
    /// 0 is the main track, 1 and up are bonuses.
    pub track: i32,
    pub id: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flags: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub point_a: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub point_b: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dest: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

pub fn routes() -> OpenApiRouter<AppState> {
    // Servers load zones on every map change, and a map's zones rarely change.
    OpenApiRouter::new()
        .routes(routes!(map_zones))
        .layer(axum::middleware::from_fn(crate::etag::conditional))
}

/// The map's current zone set. 404 means SourceJump has no zones for it, and servers don't submit runs there.
#[utoipa::path(
    get,
    path = "/v1/maps/{map}/zones",
    tag = "maps",
    params(("map" = String, Path, description = "Map name")),
    responses(
        (status = OK, body = Vec<Zone>, headers(
            ("SourceJump-Zone-Set-Version" = i32, description = "The zone set's version, to tie a run's zone fingerprint to the set it was played on"),
        )),
        (status = NOT_FOUND, description = "SourceJump has no zones for this map", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a valid map name", body = ErrorBody),
    ),
)]
async fn map_zones(
    State(state): State<AppState>,
    Path(map): Path<String>,
) -> Result<([(&'static str, String); 1], Json<Vec<Zone>>), ApiError> {
    let map = MapName::try_from(map).map_err(ApiError::Invalid)?;
    let current = sqlx::query!(
        r#"
        SELECT z.version, z.zones AS "zones: JsonColumn<Vec<Zone>>"
        FROM map_zones z JOIN maps m ON m.id = z.map_id
        WHERE m.name = $1
        ORDER BY z.version DESC
        LIMIT 1
        "#,
        map.as_str()
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::NotFound("SourceJump has no zones for this map"))?;
    // A header, because the body must stay exactly the array shavit-zones-json reads.
    Ok((
        [(ZONE_SET_VERSION, current.version.to_string())],
        Json(current.zones.0),
    ))
}

/// Reads a shavit zones file.
pub fn parse(json: &str) -> Result<Vec<Zone>, String> {
    serde_json::from_str(json).map_err(|error| format!("not a shavit zones file: {error}"))
}

/// Refuses a zone set shavit would misread or that has no complete main track.
pub fn check(zones: &[Zone]) -> Result<(), String> {
    if zones.is_empty() {
        return Err("the zone set is empty".into());
    }
    if zones.len() > MAX_ZONES {
        return Err(format!("shavit holds at most {MAX_ZONES} zones on a map"));
    }
    if let Some(zone) = zones
        .iter()
        .find(|zone| !(0..=LAST_TRACK).contains(&zone.track))
    {
        return Err(format!(
            "track {} doesn't exist in shavit: 0 is the main track, bonuses are 1 to {LAST_TRACK}",
            zone.track
        ));
    }
    if let Some(zone) = zones
        .iter()
        .find(|zone| !ZONE_TYPES.contains(&zone.kind.as_str()))
    {
        return Err(format!("unknown zone type {:?}", zone.kind));
    }
    let has = |kind: &str| {
        zones
            .iter()
            .any(|zone| zone.kind == kind && zone.track == 0)
    };
    if !has("start") || !has("end") {
        return Err("the main track needs a start and an end zone".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::{check, parse};
    use crate::{maps::MapName, staff::maps::publish_zones, test_client};

    /// Publishes a zones file as the next version, as `zones import` does.
    async fn import(db: &PgPool, map: &MapName, json: &str) -> Result<i32, String> {
        let zones = parse(json)?;
        check(&zones)?;
        let current = sqlx::query_scalar!(
            "SELECT max(z.version) FROM map_zones z JOIN maps m ON m.id = z.map_id WHERE m.name = $1",
            map.as_str()
        )
        .fetch_one(db)
        .await
        .unwrap();
        publish_zones(db, None, map, current, &zones, None)
            .await
            .map_err(|error| format!("{error:?}"))
    }

    fn badges() -> MapName {
        MapName::try_from("bhop_badges".to_owned()).unwrap()
    }

    fn zone_set(end_x: f64) -> Value {
        json!([
            { "type": "start", "track": 0, "id": 1, "point_a": [0.0, 0.0, 0.0], "point_b": [64.0, 64.0, 64.0] },
            { "type": "end", "track": 0, "id": 2, "point_a": [end_x, 0.0, 0.0], "point_b": [1064.0, 64.0, 64.0], "flags": 2 },
        ])
    }

    #[sqlx::test]
    async fn serves_the_newest_zone_set_as_imported(db: PgPool) {
        import(&db, &badges(), &zone_set(1000.0).to_string())
            .await
            .unwrap();
        let version = import(&db, &badges(), &zone_set(2000.0).to_string())
            .await
            .unwrap();

        let response = test_client::get(&db, "/v1/maps/bhop_badges/zones").await;

        assert_eq!(version, 2);
        assert_eq!(response.status, 200);
        assert_eq!(response.json::<Value>(), zone_set(2000.0));
    }

    #[sqlx::test]
    async fn a_known_zone_set_comes_back_as_304_until_a_new_one_is_published(db: PgPool) {
        import(&db, &badges(), &zone_set(1000.0).to_string())
            .await
            .unwrap();
        let get = |etag: Option<String>| {
            let db = db.clone();
            async move {
                let mut request = axum::http::Request::get("/v1/maps/bhop_badges/zones");
                if let Some(etag) = etag {
                    request = request.header("if-none-match", etag);
                }
                test_client::send(&db, request.body(axum::body::Body::empty()).unwrap()).await
            }
        };

        let version = |response: &test_client::TestResponse| {
            response.headers["sourcejump-zone-set-version"]
                .to_str()
                .unwrap()
                .to_owned()
        };

        let first = get(None).await;
        assert_eq!(version(&first), "1");
        let etag = first.headers["etag"].to_str().unwrap().to_owned();
        let again = get(Some(etag.clone())).await;
        assert_eq!((again.status, again.body.len()), (304, 0));

        import(&db, &badges(), &zone_set(2000.0).to_string())
            .await
            .unwrap();
        let changed = get(Some(etag.clone())).await;
        assert_eq!((changed.status, version(&changed)), (200, "2".to_owned()));

        // The first set again: same body and tag, newer version.
        import(&db, &badges(), &zone_set(1000.0).to_string())
            .await
            .unwrap();
        let republished = get(Some(etag)).await;
        assert_eq!(
            (republished.status, version(&republished)),
            (304, "3".to_owned())
        );
    }

    #[sqlx::test]
    async fn a_map_without_zones_is_not_found(db: PgPool) {
        assert_eq!(
            test_client::get(&db, "/v1/maps/bhop_none/zones")
                .await
                .status,
            404
        );
        assert_eq!(
            test_client::get(&db, "/v1/maps/bad%20name/zones")
                .await
                .status,
            422
        );
    }

    #[sqlx::test]
    async fn imports_reject_what_shavit_would_misread(db: PgPool) {
        let unknown_type = json!([{ "type": "start", "track": 0, "id": 1 }, { "type": "finish", "track": 0, "id": 2 }]);
        let no_end = json!([{ "type": "start", "track": 0, "id": 1 }]);
        let bonus_nine = json!([
            { "type": "start", "track": 0, "id": 1 },
            { "type": "end", "track": 0, "id": 2 },
            { "type": "start", "track": 9, "id": 3 },
        ]);
        let too_many: Vec<Value> = (0..129)
            .map(
                |id| json!({ "type": if id == 0 { "start" } else { "end" }, "track": 0, "id": id }),
            )
            .collect();

        assert!(
            import(&db, &badges(), &unknown_type.to_string())
                .await
                .unwrap_err()
                .contains("finish")
        );
        assert!(
            import(&db, &badges(), &no_end.to_string())
                .await
                .unwrap_err()
                .contains("end zone")
        );
        assert!(
            import(&db, &badges(), &bonus_nine.to_string())
                .await
                .unwrap_err()
                .contains("track 9")
        );
        assert!(
            import(&db, &badges(), &Value::from(too_many).to_string())
                .await
                .unwrap_err()
                .contains("at most 128")
        );
        assert!(import(&db, &badges(), "{}").await.is_err());
    }
}
