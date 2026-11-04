//! CS:S's stock content for the web viewer: textures, models and materials maps use without packing them.
//!
//! The viewer reads them straight out of the game's own VPK archives with range requests, so a visitor fetches
//! the three archive indexes (brotli-compressed, about 0.55 MB) and only the pieces a map uses, and the browser
//! caches them across replays. The archives (about 3.2 GB) are stored once, uploaded from a CS:S install with the CLI. Valve's
//! files may be served this way; if Valve objects, they come off (lead, 2026-10-23).

use std::{path::Path, time::Duration};

use crate::storage::Storage;

/// Where the archives are stored. The files never change under a key, so a new CS:S build would go under a
/// new prefix.
pub const PREFIX: &str = "stock/css-v1";
/// The archive sets the viewer mounts, in search order, with the folder of a CS:S install each is in.
pub const ARCHIVES: [(&str, &str); 3] = [
    ("cstrike", "cstrike_pak"),
    ("hl2", "hl2_textures"),
    ("hl2", "hl2_misc"),
];
/// One archive part is up to about 200 MB, which a slow link can take minutes to send.
const UPLOAD_TIMEOUT: Duration = Duration::from_mins(30);

/// Where browsers read the archives: `{url}/{archive}_dir.vpk` and its numbered parts.
pub fn url(storage: &Storage) -> String {
    storage.public_url(PREFIX)
}

/// Uploads every archive file from a CS:S install folder, skipping those already stored at the same size.
/// Returns how many files were uploaded.
pub async fn upload(storage: &Storage, install: &Path) -> Result<usize, String> {
    let stored = storage
        .list(&format!("{PREFIX}/"))
        .await
        .map_err(|error| format!("couldn't list what's stored: {error}"))?;
    let http = reqwest::Client::builder()
        .timeout(UPLOAD_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let mut uploaded = 0;
    for (folder, archive) in ARCHIVES {
        let files = archive_files(&install.join(folder), archive)?;
        if files.is_empty() {
            return Err(format!(
                "{} has no {archive}_*.vpk; is it a CS:S install?",
                install.join(folder).display()
            ));
        }
        for (name, size) in files {
            let key = format!("{PREFIX}/{name}");
            let path = install.join(folder).join(&name);
            let read =
                || std::fs::read(&path).map_err(|error| format!("{}: {error}", path.display()));
            // Every visitor downloads the indexes whole, so they're stored brotli-compressed (1.6 MB to about
            // 0.55 MB). The parts are read in byte ranges, which a content encoding would break.
            let index = name
                .ends_with("_dir.vpk")
                .then(|| read().map(|bytes| viewer_pack::compress_for_browsers(&bytes)))
                .transpose()?;
            let stored_size = index.as_ref().map_or(size, |bytes| bytes.len() as u64);
            if stored
                .iter()
                .any(|object| object.key == key && object.size == stored_size)
            {
                continue;
            }
            // Signed just before it's sent, so the link's minute-long lifetime is enough.
            let request = http
                .put(storage.presign_put(&key, Duration::from_mins(1)))
                .header("content-type", "application/octet-stream")
                .header("cache-control", "public, max-age=31536000, immutable");
            let request = match index {
                Some(bytes) => request.header("content-encoding", "br").body(bytes),
                None => request.body(read()?),
            };
            let response = request
                .send()
                .await
                .map_err(|error| format!("{name}: {error}"))?;
            if !response.status().is_success() {
                return Err(format!("{name}: storage answered {}", response.status()));
            }
            println!("Uploaded {name} ({stored_size} bytes stored).");
            uploaded += 1;
        }
    }
    Ok(uploaded)
}

/// The archive's index and numbered parts in `folder` (`{archive}_dir.vpk`, `{archive}_000.vpk`, …), with sizes.
fn archive_files(folder: &Path, archive: &str) -> Result<Vec<(String, u64)>, String> {
    let entries =
        std::fs::read_dir(folder).map_err(|error| format!("{}: {error}", folder.display()))?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(part) = name
            .strip_prefix(archive)
            .and_then(|rest| rest.strip_prefix('_'))
            .and_then(|rest| rest.strip_suffix(".vpk"))
        else {
            continue;
        };
        if part == "dir" || (part.len() == 3 && part.bytes().all(|byte| byte.is_ascii_digit())) {
            let size = entry.metadata().map_err(|error| error.to_string())?.len();
            files.push((name, size));
        }
    }
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::archive_files;

    #[test]
    fn finds_an_archives_index_and_parts_only() {
        let folder = std::env::temp_dir().join(format!("sj-stock-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        for name in [
            "hl2_misc_dir.vpk",
            "hl2_misc_000.vpk",
            "hl2_misc_001.vpk",
            "hl2_textures_dir.vpk",
            "hl2_misc_000.vpk.bak",
            "hl2_misc_extra.vpk",
        ] {
            std::fs::write(folder.join(name), b"x").unwrap();
        }
        let names: Vec<String> = archive_files(&folder, "hl2_misc")
            .unwrap()
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        std::fs::remove_dir_all(&folder).unwrap();
        assert_eq!(
            names,
            ["hl2_misc_000.vpk", "hl2_misc_001.vpk", "hl2_misc_dir.vpk"]
        );
    }
}
