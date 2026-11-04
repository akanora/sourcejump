//! A map's pictures (`manage_maps`): up to 10 in an order staff choose, the first being the cover shown as
//! the banner and in lists. Each upload is processed by `maps/image.rs` into fixed WebP files in object
//! storage; each picture keeps the strip a short banner shows of it, so any of them can become the cover.
//!
//! Files are stored before a picture is recorded, so a map never points at a missing file, and a removed
//! picture's files are deleted after. Changes to one map's pictures lock its `maps` row, so two staff
//! members adding at once can't both take the last place.

use axum::{
    Json,
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgConnection, PgPool};
use utoipa::ToSchema;

use super::{
    ChangeError,
    access::Staff,
    log::{self, StaffAction},
    maps::{NO_MAP, map_name},
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    maps::{
        MapName,
        image::{self, MAX_IMAGES},
    },
    players::{SteamId64, privileges::Privilege},
    storage::Storage,
};

/// Locks the map's row for a change to its pictures and returns its ID.
async fn lock_map(conn: &mut PgConnection, map: &MapName) -> Result<i64, ChangeError> {
    sqlx::query_scalar!(
        "SELECT id FROM maps WHERE name = $1 FOR UPDATE",
        map.as_str()
    )
    .fetch_optional(conn)
    .await?
    .ok_or(NO_MAP)
}

async fn count(conn: &mut PgConnection, map_id: i64) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM map_images WHERE map_id = $1"#,
        map_id
    )
    .fetch_one(conn)
    .await
}

fn full() -> ChangeError {
    ChangeError::Invalid(format!(
        "a map holds {MAX_IMAGES} pictures; remove one first"
    ))
}

/// Adds an uploaded picture after the map's others, and returns its ID. The first picture becomes the cover.
pub async fn add_image(
    db: &PgPool,
    storage: &Storage,
    actor: Option<SteamId64>,
    map: &MapName,
    upload: Vec<u8>,
) -> Result<i64, ChangeError> {
    // Checked before the work of processing, and again under the lock before recording.
    let map_id = {
        let mut conn = db.acquire().await?;
        let map_id = sqlx::query_scalar!("SELECT id FROM maps WHERE name = $1", map.as_str())
            .fetch_optional(&mut *conn)
            .await?
            .ok_or(NO_MAP)?;
        if count(&mut conn, map_id).await? >= MAX_IMAGES {
            return Err(full());
        }
        map_id
    };
    // Decoding and encoding take a moment of CPU; off the async workers, they don't hold up other requests.
    let processed = tokio::task::spawn_blocking(move || image::process(&upload))
        .await
        .map_err(|error| ChangeError::Invalid(format!("the image couldn't be processed: {error}")))?
        .map_err(ChangeError::Invalid)?;
    let key = format!("maps/{}/{}", map.as_str(), processed.hash);
    let already = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM map_images WHERE key = $1) AS "exists!""#,
        key
    )
    .fetch_one(db)
    .await?;
    if already {
        return Err(ChangeError::Invalid(
            "that picture is already one of the map's".to_owned(),
        ));
    }
    for (size, bytes) in [
        (image::LARGE, processed.large),
        (image::SMALL, processed.small),
    ] {
        storage
            .put_immutable(&image::file_key(&key, size), "image/webp", None, bytes)
            .await
            .map_err(ChangeError::Storage)?;
    }

    let mut tx = db.begin().await?;
    lock_map(&mut tx, map).await?;
    let position = count(&mut tx, map_id).await?;
    if position >= MAX_IMAGES {
        return Err(full());
    }
    let id = sqlx::query_scalar!(
        "INSERT INTO map_images (map_id, key, position, added_by) VALUES ($1, $2, $3, $4) RETURNING id",
        map_id,
        key,
        i16::try_from(position).expect("under 10"),
        actor.map(SteamId64::get)
    )
    .fetch_one(&mut *tx)
    .await?;
    let entry = log::Entry {
        actor,
        action: StaffAction::AddMapImage,
        target: map.as_str(),
        reason: None,
        detail: json!({ "image": key, "cover": position == 0 }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(id)
}

/// Gives a map that has no pictures its first ones, in order, the first being the cover, as one logged
/// change with `note` as its reason. Returns false, changing nothing, when the map has pictures by now: an
/// import fills empty maps and never adds to what staff chose. `images` holds at most `MAX_IMAGES`, each once.
pub async fn add_first_images(
    db: &PgPool,
    storage: &Storage,
    map: &MapName,
    images: Vec<image::Processed>,
    note: &str,
) -> Result<bool, ChangeError> {
    assert!(
        (1..=MAX_IMAGES).contains(&i64::try_from(images.len()).expect("small")),
        "between one and {MAX_IMAGES} pictures"
    );
    let mut keys = Vec::with_capacity(images.len());
    for processed in images {
        let key = format!("maps/{}/{}", map.as_str(), processed.hash);
        for (size, bytes) in [
            (image::LARGE, processed.large),
            (image::SMALL, processed.small),
        ] {
            storage
                .put_immutable(&image::file_key(&key, size), "image/webp", None, bytes)
                .await
                .map_err(ChangeError::Storage)?;
        }
        keys.push(key);
    }

    let mut tx = db.begin().await?;
    let map_id = lock_map(&mut tx, map).await?;
    if count(&mut tx, map_id).await? > 0 {
        // Files stored for nothing cost a little space and nothing else, as after a removal.
        return Ok(false);
    }
    for (position, key) in (0_i16..).zip(&keys) {
        sqlx::query!(
            "INSERT INTO map_images (map_id, key, position) VALUES ($1, $2, $3)",
            map_id,
            key,
            position
        )
        .execute(&mut *tx)
        .await?;
    }
    let entry = log::Entry {
        actor: None,
        action: StaffAction::AddMapImage,
        target: map.as_str(),
        reason: Some(note),
        detail: json!({ "images": keys, "cover": true }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(true)
}

/// Removes one of the map's pictures; those after it move up, so removing the cover makes the next one it.
pub async fn remove_image(
    db: &PgPool,
    storage: &Storage,
    actor: Option<SteamId64>,
    map: &MapName,
    image_id: i64,
) -> Result<(), ChangeError> {
    let mut tx = db.begin().await?;
    let map_id = lock_map(&mut tx, map).await?;
    let removed = sqlx::query!(
        "DELETE FROM map_images WHERE id = $1 AND map_id = $2 RETURNING key, position",
        image_id,
        map_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ChangeError::NotFound("the map has no such picture"))?;
    sqlx::query!(
        "UPDATE map_images SET position = position - 1 WHERE map_id = $1 AND position > $2",
        map_id,
        removed.position
    )
    .execute(&mut *tx)
    .await?;
    let entry = log::Entry {
        actor,
        action: StaffAction::RemoveMapImage,
        target: map.as_str(),
        reason: None,
        detail: json!({ "image": removed.key, "cover": removed.position == 0 }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;

    // A failure leaves unused files in storage, which costs a little space and nothing else, so it's
    // logged rather than undoing a change that worked.
    for size in [image::LARGE, image::SMALL] {
        if let Err(error) = storage.delete(&image::file_key(&removed.key, size)).await {
            tracing::warn!(%error, key = removed.key, "couldn't remove a map picture's file");
        }
    }
    Ok(())
}

/// Puts the map's pictures in the given order, the cover first. `order` names every picture once.
pub async fn order_images(
    db: &PgPool,
    actor: Option<SteamId64>,
    map: &MapName,
    order: &[i64],
) -> Result<(), ChangeError> {
    let mut tx = db.begin().await?;
    let map_id = lock_map(&mut tx, map).await?;
    let current = sqlx::query!(
        "SELECT id, key FROM map_images WHERE map_id = $1 ORDER BY position",
        map_id
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut given = order.to_vec();
    given.sort_unstable();
    let mut held: Vec<i64> = current.iter().map(|row| row.id).collect();
    held.sort_unstable();
    if given != held {
        return Err(ChangeError::Invalid(
            "name each of the map's pictures once".to_owned(),
        ));
    }
    if current.iter().map(|row| row.id).eq(order.iter().copied()) {
        return Err(ChangeError::Unchanged);
    }
    // The order constraint is checked at commit, so pictures can pass through each other's places here.
    sqlx::query!(
        r#"
        UPDATE map_images i SET position = o.position - 1
        FROM unnest($2::bigint[]) WITH ORDINALITY AS o(id, position)
        WHERE i.id = o.id AND i.map_id = $1
        "#,
        map_id,
        order
    )
    .execute(&mut *tx)
    .await?;
    let keys: Vec<&str> = order
        .iter()
        .filter_map(|id| current.iter().find(|row| row.id == *id))
        .map(|row| row.key.as_str())
        .collect();
    let entry = log::Entry {
        actor,
        action: StaffAction::OrderMapImages,
        target: map.as_str(),
        reason: None,
        detail: json!({ "images": keys }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(())
}

/// Moves which strip of a picture a short banner shows.
pub async fn set_focus(
    db: &PgPool,
    actor: Option<SteamId64>,
    map: &MapName,
    image_id: i64,
    focus: i16,
) -> Result<(), ChangeError> {
    if !(0..=100).contains(&focus) {
        return Err(ChangeError::Invalid(
            "the focus is 0 (top) to 100 (bottom)".to_owned(),
        ));
    }
    let mut tx = db.begin().await?;
    let map_id = lock_map(&mut tx, map).await?;
    let row = sqlx::query!(
        "SELECT key, focus FROM map_images WHERE id = $1 AND map_id = $2",
        image_id,
        map_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ChangeError::NotFound("the map has no such picture"))?;
    if row.focus == focus {
        return Err(ChangeError::Unchanged);
    }
    sqlx::query!(
        "UPDATE map_images SET focus = $2 WHERE id = $1",
        image_id,
        focus
    )
    .execute(&mut *tx)
    .await?;
    let entry = log::Entry {
        actor,
        action: StaffAction::SetBannerFocus,
        target: map.as_str(),
        reason: None,
        detail: json!({ "image": row.key, "focus": focus }),
    };
    log::record(&mut tx, entry).await?;
    tx.commit().await?;
    Ok(())
}

/// The picture's bytes, sent as the whole request body. Only describes the body for the API schema; the
/// handler reads it as `Bytes`.
#[derive(ToSchema)]
#[schema(value_type = String, format = Binary)]
#[expect(
    dead_code,
    reason = "only describes the request body for the API schema"
)]
pub struct ImageUpload(Vec<u8>);

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AddedImage {
    pub id: i64,
}

/// Add a picture to the map: the request body is the picture itself (PNG, JPEG or WebP, up to 15 MB, at least
/// 1920×1080 once cropped to 16:9). SourceJump stores it as 1920×1080 and 480×270 WebP, after the map's
/// other pictures; a map's first picture is its cover.
#[utoipa::path(
    post,
    path = "/v1/staff/maps/{map}/images",
    tag = "staff",
    params(("map" = String, Path, description = "Map name")),
    request_body(content = ImageUpload, content_type = "image/*"),
    responses(
        (status = CREATED, body = AddedImage),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such map", body = ErrorBody),
        (status = PAYLOAD_TOO_LARGE, description = "Over 15 MB"),
        (status = UNPROCESSABLE_ENTITY, description = "Not a readable picture, too small, already the map's, or 10 already", body = ErrorBody),
    ),
)]
pub async fn post_image(
    State(state): State<AppState>,
    staff: Staff,
    Path(map): Path<String>,
    body: Bytes,
) -> Result<(StatusCode, Json<AddedImage>), ApiError> {
    staff.require(Privilege::ManageMaps)?;
    let id = add_image(
        &state.db,
        &state.storage,
        Some(staff.steamid64),
        &map_name(map)?,
        body.to_vec(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(AddedImage { id })))
}

/// Remove one of the map's pictures.
#[utoipa::path(
    delete,
    path = "/v1/staff/maps/{map}/images/{id}",
    tag = "staff",
    params(
        ("map" = String, Path, description = "Map name"),
        ("id" = i64, Path, description = "The picture's ID"),
    ),
    responses(
        (status = NO_CONTENT, description = "Removed"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such map, or not one of its pictures", body = ErrorBody),
    ),
)]
pub async fn delete_image(
    State(state): State<AppState>,
    staff: Staff,
    Path((map, id)): Path<(String, i64)>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageMaps)?;
    remove_image(
        &state.db,
        &state.storage,
        Some(staff.steamid64),
        &map_name(map)?,
        id,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ImageOrderRequest {
    /// Every one of the map's pictures by ID, once, in the new order; the first is the cover.
    pub images: Vec<i64>,
}

/// Reorder the map's pictures; the first becomes the cover.
#[utoipa::path(
    put,
    path = "/v1/staff/maps/{map}/images/order",
    tag = "staff",
    params(("map" = String, Path, description = "Map name")),
    request_body = ImageOrderRequest,
    responses(
        (status = NO_CONTENT, description = "Reordered"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such map", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not each picture once, or unchanged", body = ErrorBody),
    ),
)]
pub async fn put_image_order(
    State(state): State<AppState>,
    staff: Staff,
    Path(map): Path<String>,
    JsonBody(request): JsonBody<ImageOrderRequest>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageMaps)?;
    order_images(
        &state.db,
        Some(staff.steamid64),
        &map_name(map)?,
        &request.images,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ImageFocusRequest {
    /// 0 the top of the picture, 100 the bottom.
    pub focus: i16,
}

/// Move which strip of a picture a short banner shows.
#[utoipa::path(
    put,
    path = "/v1/staff/maps/{map}/images/{id}/focus",
    tag = "staff",
    params(
        ("map" = String, Path, description = "Map name"),
        ("id" = i64, Path, description = "The picture's ID"),
    ),
    request_body = ImageFocusRequest,
    responses(
        (status = NO_CONTENT, description = "Set"),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_maps, from SourceJump's pages", body = ErrorBody),
        (status = NOT_FOUND, description = "No such map, or not one of its pictures", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Out of range, or unchanged", body = ErrorBody),
    ),
)]
pub async fn put_image_focus(
    State(state): State<AppState>,
    staff: Staff,
    Path((map, id)): Path<(String, i64)>,
    JsonBody(request): JsonBody<ImageFocusRequest>,
) -> Result<StatusCode, ApiError> {
    staff.require(Privilege::ManageMaps)?;
    set_focus(
        &state.db,
        Some(staff.steamid64),
        &map_name(map)?,
        id,
        request.focus,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::{Value, json};

    use super::*;
    use crate::{
        auth::sessions,
        maps::image::{MapImage, tests::png},
        players::privileges::{self, Privileges},
        staff::maps::StaffMap,
        test_client::{self, TestResponse},
    };

    const STAFF: &str = "76561197960287930";
    const MAP: &str = "/v1/staff/maps/bhop_fresh";

    async fn session(db: &PgPool, held: &[Privilege]) -> String {
        let steamid64 = SteamId64::parse_any(STAFF).unwrap();
        privileges::grant(db, steamid64, Privileges::of(held))
            .await
            .unwrap();
        sessions::create(db, steamid64).await.unwrap()
    }

    /// Sends through `state`, so the files it stores can be checked; `body` is a picture or JSON.
    async fn send(
        state: &AppState,
        method: &str,
        path: &str,
        token: &str,
        body: Option<(&str, Vec<u8>)>,
    ) -> TestResponse {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header("origin", "https://sourcejump.test")
            .header("cookie", format!("{}={token}", sessions::COOKIE));
        if let Some((content_type, _)) = &body {
            request = request.header("content-type", *content_type);
        }
        let body = body.map_or_else(Body::empty, |(_, bytes)| Body::from(bytes));
        test_client::send_to(state.clone(), request.body(body).unwrap()).await
    }

    fn json_body(value: &Value) -> (&'static str, Vec<u8>) {
        ("application/json", value.to_string().into_bytes())
    }

    async fn add(state: &AppState, token: &str, width: u32) -> TestResponse {
        let path = format!("{MAP}/images");
        send(
            state,
            "POST",
            &path,
            token,
            Some(("image/png", png(width, width * 9 / 16))),
        )
        .await
    }

    async fn images(state: &AppState, token: &str) -> Vec<MapImage> {
        let map: StaffMap = send(state, "GET", MAP, token, None).await.json();
        map.images
    }

    fn stored(state: &AppState) -> usize {
        state.storage.objects.lock().unwrap().len()
    }

    async fn new_map(db: &PgPool) {
        sqlx::query!("INSERT INTO maps (name) VALUES ('bhop_fresh')")
            .execute(db)
            .await
            .unwrap();
    }

    #[sqlx::test]
    async fn staff_add_order_and_remove_a_maps_pictures(db: PgPool) {
        new_map(&db).await;
        let state = AppState::for_tests(db.clone());
        let token = session(&db, &[Privilege::ManageMaps]).await;

        let ids: Vec<i64> = {
            let mut ids = Vec::new();
            for width in [1920, 2560, 3840] {
                let added = add(&state, &token, width).await;
                assert_eq!(added.status, 201);
                ids.push(added.json::<AddedImage>().id);
            }
            ids
        };
        assert_eq!(
            add(&state, &token, 1920).await.status,
            422,
            "the same picture twice"
        );
        assert_eq!(stored(&state), 6);
        let shown: Vec<i64> = images(&state, &token).await.iter().map(|i| i.id).collect();
        assert_eq!(shown, ids);

        let order = json!({ "images": [ids[2], ids[0], ids[1]] });
        let path = format!("{MAP}/images/order");
        assert_eq!(
            send(&state, "PUT", &path, &token, Some(json_body(&order)))
                .await
                .status,
            204
        );
        let partial = json!({ "images": [ids[0], ids[1]] });
        assert_eq!(
            send(&state, "PUT", &path, &token, Some(json_body(&partial)))
                .await
                .status,
            422
        );

        let focus = json!({ "focus": 20 });
        let path = format!("{MAP}/images/{}/focus", ids[2]);
        assert_eq!(
            send(&state, "PUT", &path, &token, Some(json_body(&focus)))
                .await
                .status,
            204
        );
        let cover = &images(&state, &token).await[0];
        assert_eq!((cover.id, cover.focus), (ids[2], 20));

        // Removing the cover makes the next picture the cover, and its files go.
        let path = format!("{MAP}/images/{}", ids[2]);
        assert_eq!(
            send(&state, "DELETE", &path, &token, None).await.status,
            204
        );
        assert_eq!(
            send(&state, "DELETE", &path, &token, None).await.status,
            404
        );
        let shown: Vec<i64> = images(&state, &token).await.iter().map(|i| i.id).collect();
        assert_eq!(shown, [ids[0], ids[1]]);
        assert_eq!(stored(&state), 4);

        let logged: Vec<String> = sqlx::query_scalar!("SELECT action FROM staff_log ORDER BY id")
            .fetch_all(&db)
            .await
            .unwrap();
        assert_eq!(
            logged,
            [
                "add_map_image",
                "add_map_image",
                "add_map_image",
                "order_map_images",
                "set_banner_focus",
                "remove_map_image"
            ]
        );
    }

    #[sqlx::test]
    async fn a_map_holds_ten_pictures(db: PgPool) {
        new_map(&db).await;
        sqlx::query!(
            "INSERT INTO map_images (map_id, key, position)
             SELECT m.id, 'maps/bhop_fresh/' || lpad(n::text, 12, '0'), n
             FROM maps m, generate_series(0, 9) n WHERE m.name = 'bhop_fresh'"
        )
        .execute(&db)
        .await
        .unwrap();
        let state = AppState::for_tests(db.clone());
        let token = session(&db, &[Privilege::ManageMaps]).await;
        assert_eq!(add(&state, &token, 1920).await.status, 422);
        assert_eq!(stored(&state), 0, "refused before anything is stored");
    }

    #[sqlx::test]
    async fn pictures_need_manage_maps(db: PgPool) {
        new_map(&db).await;
        let state = AppState::for_tests(db.clone());
        let token = session(&db, &[Privilege::ManageZones]).await;
        assert_eq!(add(&state, &token, 1920).await.status, 403);
        let order = json!({ "images": [] });
        for (method, path, body) in [
            ("DELETE", format!("{MAP}/images/1"), None),
            (
                "PUT",
                format!("{MAP}/images/order"),
                Some(json_body(&order)),
            ),
            (
                "PUT",
                format!("{MAP}/images/1/focus"),
                Some(json_body(&json!({ "focus": 1 }))),
            ),
        ] {
            assert_eq!(
                send(&state, method, &path, &token, body).await.status,
                403,
                "{path}"
            );
        }
    }
}
