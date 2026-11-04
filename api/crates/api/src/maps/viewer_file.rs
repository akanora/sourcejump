//! Map files for the web viewer: each map stripped to what the viewer reads and brotli-compressed
//! (`viewer-pack`, from the `sourcejump-packer` repo), stored as a public file that never changes.
//!
//! The file is stored with `Content-Encoding: br`, so browsers decode it themselves as it downloads; the viewer
//! needs no decoder of its own. Its key holds a hash of the stripped map, so it is cached for good and a changed
//! map gets a new key. Staff pack maps in their browser and upload them (`staff/map_viewer_file.rs`).

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

use crate::storage::Storage;

/// A map's file for the viewer.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ViewerFile {
    /// A stripped `.bsp`, served with `Content-Encoding: br` and cached for good.
    pub url: String,
    /// Bytes on the wire, before the browser decodes it.
    pub bytes: i64,
    /// Where the viewer reads CS:S's stock content: `{stock_content_url}/{archive}_dir.vpk` and its numbered
    /// parts, for the archives `cstrike_pak`, `hl2_textures` and `hl2_misc`, searched in that order after the
    /// map's own packed files. Read by range request.
    pub stock_content_url: String,
}

/// The map's viewer file, if one has been uploaded.
pub async fn of_map(
    db: &PgPool,
    storage: &Storage,
    map_id: i64,
) -> Result<Option<ViewerFile>, sqlx::Error> {
    let row = sqlx::query!(
        "SELECT object_key, stored_bytes FROM map_viewer_files WHERE map_id = $1",
        map_id
    )
    .fetch_optional(db)
    .await?;
    Ok(row.map(|row| ViewerFile {
        url: storage.public_url(&row.object_key),
        bytes: row.stored_bytes,
        stock_content_url: super::stock_content::url(storage),
    }))
}
