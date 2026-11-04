//! Giving maps their first pictures from a folder at once, `sourcejump-api maps import-pictures`: one folder per
//! map, named after it, holding its screenshots directly or in `screenshots/` (as the sourceindex.net export keeps
//! them). Every picture is read and encoded on the machine running the command, so only the finished WebP files
//! are uploaded. Maps that have pictures are skipped, so a rerun only adds what is still missing.

use std::{
    collections::HashSet,
    num::NonZero,
    path::{Path, PathBuf},
};

use futures_util::{StreamExt, stream};
use image::ImageReader;
use sqlx::PgPool;

use super::{MAX_IMAGES, check_size, process_file};
use crate::{maps::MapName, staff::map_images::add_first_images, storage::Storage};

/// What an import did, or with a dry run would do.
#[derive(Debug, Default)]
pub struct Report {
    /// Maps given pictures, and how many.
    pub imported: Vec<(String, usize)>,
    /// Map folders left alone: the folder's name and why.
    pub skipped_maps: Vec<(String, String)>,
    /// Pictures left out, as `<map folder>/<file>`, and why.
    pub skipped_pictures: Vec<(String, String)>,
}

/// One map's pictures to import, in order, each with the name the report gives it.
struct Plan {
    map: MapName,
    pictures: Vec<(String, PathBuf)>,
}

/// Gives each map folder's map its first pictures, at most 10, the map owner's shot (`<map>_owner_*`) first as
/// the cover and the rest by file name. Each map is one change, logged with `note`. A picture too small to fill
/// 1920×1080 once cropped to 16:9 is left out rather than scaled up. `progress` hears how many maps are done out
/// of how many. With `dry_run`, pictures are only measured, so the report can't yet know which are damaged or
/// repeated; nothing is written.
pub async fn import_folder(
    db: &PgPool,
    storage: &Storage,
    folder: &Path,
    note: &str,
    dry_run: bool,
    mut progress: impl FnMut(usize, usize),
) -> Result<Report, Box<dyn std::error::Error>> {
    let known: HashSet<String> = sqlx::query_scalar!("SELECT name FROM maps")
        .fetch_all(db)
        .await?
        .into_iter()
        .collect();
    let with_pictures: HashSet<String> = sqlx::query_scalar!(
        "SELECT DISTINCT m.name FROM map_images i JOIN maps m ON m.id = i.map_id"
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .collect();
    let mut report = Report::default();
    let plans = plan(folder, &known, &with_pictures, &mut report)?;

    if dry_run {
        report.imported = plans
            .iter()
            .map(|plan| (plan.map.as_str().to_owned(), plan.pictures.len()))
            .collect();
        return Ok(report);
    }
    // Maps are encoded side by side, one per core; within a map, pictures go one at a time.
    let workers = std::thread::available_parallelism().map_or(4, NonZero::get);
    let total = plans.len();
    let mut maps = stream::iter(plans)
        .map(|plan| import_map(db, storage, plan, note))
        .buffer_unordered(workers);
    let mut done = 0;
    while let Some(outcome) = maps.next().await {
        let outcome = outcome?;
        done += 1;
        progress(done, total);
        report.skipped_pictures.extend(outcome.skipped_pictures);
        match outcome.added {
            Ok(count) => report.imported.push((outcome.map, count)),
            Err(why) => report.skipped_maps.push((outcome.map, why)),
        }
    }
    report.imported.sort();
    report.skipped_maps.sort();
    report.skipped_pictures.sort();
    Ok(report)
}

/// Picks each map folder's pictures, reading only their headers, and reports what it leaves out.
fn plan(
    folder: &Path,
    known: &HashSet<String>,
    with_pictures: &HashSet<String>,
    report: &mut Report,
) -> std::io::Result<Vec<Plan>> {
    let mut folders = entries(folder)?;
    folders.retain(|path| path.is_dir());
    let mut seen = HashSet::new();
    let mut plans = Vec::new();

    for dir in folders {
        let name = file_name(&dir);
        let skip = |report: &mut Report, why: &str| {
            report.skipped_maps.push((name.clone(), why.to_owned()));
        };
        let map = match MapName::try_from(name.clone()) {
            Ok(map) => map,
            Err(why) => {
                skip(report, &why);
                continue;
            }
        };
        if !seen.insert(map.as_str().to_owned()) {
            skip(report, "another folder names the same map");
            continue;
        }
        if !known.contains(map.as_str()) {
            skip(report, "the site has no such map");
            continue;
        }
        if with_pictures.contains(map.as_str()) {
            skip(report, "the map already has pictures");
            continue;
        }

        let screenshots = dir.join("screenshots");
        let mut files = entries(if screenshots.is_dir() {
            &screenshots
        } else {
            &dir
        })?;
        files.retain(|path| path.is_file());
        let owner = format!("{}_owner_", map.as_str());
        files.sort_by_cached_key(|path| {
            let file = file_name(path).to_lowercase();
            (!file.starts_with(&owner), file)
        });
        let mut pictures = Vec::new();
        for path in files {
            let label = format!("{name}/{}", file_name(&path));
            let usable = if i64::try_from(pictures.len()) == Ok(MAX_IMAGES) {
                Err(format!("the map's {MAX_IMAGES} places are taken"))
            } else {
                measure(&path)
            };
            match usable {
                Ok(()) => pictures.push((label, path)),
                Err(why) => report.skipped_pictures.push((label, why)),
            }
        }
        if pictures.is_empty() {
            skip(report, "none of its pictures can be used");
            continue;
        }
        plans.push(Plan { map, pictures });
    }
    Ok(plans)
}

/// Checks a picture's size from its header alone, so the plan doesn't decode thousands of pictures.
fn measure(path: &Path) -> Result<(), String> {
    let (width, height) = ImageReader::open(path)
        .and_then(ImageReader::with_guessed_format)
        .map_err(|error| error.to_string())?
        .into_dimensions()
        .map_err(|_| "the image couldn't be read".to_owned())?;
    check_size(width, height)
}

/// One map's import: how many pictures it was given, or why none.
struct MapOutcome {
    map: String,
    added: Result<usize, String>,
    skipped_pictures: Vec<(String, String)>,
}

/// Encodes a map's pictures and stores them. Storage and database failures stop the import; a rerun picks up
/// where it stopped.
async fn import_map(
    db: &PgPool,
    storage: &Storage,
    plan: Plan,
    note: &str,
) -> Result<MapOutcome, String> {
    let mut images = Vec::new();
    let mut hashes = HashSet::new();
    let mut skipped_pictures = Vec::new();
    for (label, path) in plan.pictures {
        // Decoding and encoding take CPU; off the async workers, every core encodes at once.
        let processed = tokio::task::spawn_blocking(move || {
            std::fs::read(&path)
                .map_err(|error| error.to_string())
                .and_then(|bytes| process_file(&bytes))
        })
        .await
        .map_err(|error| error.to_string())?;
        match processed {
            Ok(image) if hashes.insert(image.hash.clone()) => images.push(image),
            Ok(_) => skipped_pictures.push((label, "the same picture as another".to_owned())),
            Err(why) => skipped_pictures.push((label, why)),
        }
    }

    let map = plan.map.as_str().to_owned();
    let added = if images.is_empty() {
        Err("none of its pictures can be used".to_owned())
    } else {
        let count = images.len();
        let added = add_first_images(db, storage, &plan.map, images, note)
            .await
            .map_err(|error| format!("{map}: not added: {error:?}"))?;
        if added {
            Ok(count)
        } else {
            Err("the map already has pictures".to_owned())
        }
    };
    Ok(MapOutcome {
        map,
        added,
        skipped_pictures,
    })
}

fn entries(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut paths: Vec<_> = std::fs::read_dir(dir)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<_, _>>()?;
    paths.sort();
    Ok(paths)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use sqlx::PgPool;

    use super::import_folder;
    use crate::{
        maps::{
            MapName,
            image::{process, tests::png},
        },
        staff::map_images::add_image,
        storage::Storage,
    };

    #[sqlx::test]
    async fn gives_empty_maps_their_pictures_and_reports_the_rest(db: PgPool) {
        let storage = Storage::for_tests();
        for map in ["bhop_new", "bhop_with_pictures"] {
            sqlx::query("INSERT INTO maps (name) VALUES ($1)")
                .bind(map)
                .execute(&db)
                .await
                .unwrap();
        }
        let with_pictures = MapName::try_from("bhop_with_pictures".to_owned()).unwrap();
        add_image(&db, &storage, None, &with_pictures, png(1920, 1080))
            .await
            .unwrap();

        let folder = std::env::temp_dir().join(format!("sj-pictures-{}", std::process::id()));
        let shots = folder.join("bhop_new/screenshots");
        fs::create_dir_all(&shots).unwrap();
        let owner = png(2560, 1440);
        fs::write(shots.join("a.png"), png(1920, 1080)).unwrap();
        fs::write(shots.join("b-copy-of-a.png"), png(1920, 1080)).unwrap();
        fs::write(shots.join("bhop_new_owner_1.png"), &owner).unwrap();
        fs::write(shots.join("small.png"), png(1280, 800)).unwrap();
        for other in ["bhop_with_pictures", "bhop_gone"] {
            fs::create_dir_all(folder.join(other)).unwrap();
            fs::write(folder.join(other).join("a.png"), png(1920, 1080)).unwrap();
        }
        fs::write(folder.join("notes.txt"), "not a map").unwrap();

        let dry = import_folder(&db, &storage, &folder, "seed", true, |_, _| {})
            .await
            .unwrap();
        assert_eq!(dry.imported, [("bhop_new".to_owned(), 3)]);
        assert_eq!(dry.skipped_maps.len(), 2);
        assert_eq!(dry.skipped_pictures.len(), 1);
        assert!(dry.skipped_pictures[0].1.contains("1280×720"));

        let done = import_folder(&db, &storage, &folder, "seed", false, |_, _| {})
            .await
            .unwrap();
        assert_eq!(done.imported, [("bhop_new".to_owned(), 2)]);
        assert_eq!(done.skipped_pictures.len(), 2);
        let keys: Vec<String> = sqlx::query_scalar(
            "SELECT i.key FROM map_images i JOIN maps m ON m.id = i.map_id
             WHERE m.name = 'bhop_new' ORDER BY i.position",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(keys.len(), 2);
        // The owner's shot is the cover.
        assert_eq!(
            keys[0],
            format!("maps/bhop_new/{}", process(&owner).unwrap().hash)
        );
        let logged: Vec<Option<String>> =
            sqlx::query_scalar("SELECT reason FROM staff_log WHERE target = 'bhop_new'")
                .fetch_all(&db)
                .await
                .unwrap();
        assert_eq!(logged, [Some("seed".to_owned())]);

        // A rerun leaves the pictures staff now own alone.
        let again = import_folder(&db, &storage, &folder, "seed", false, |_, _| {})
            .await
            .unwrap();
        assert_eq!(again.imported, []);
        assert!(again.skipped_maps.contains(&(
            "bhop_new".to_owned(),
            "the map already has pictures".to_owned()
        )));
        fs::remove_dir_all(&folder).unwrap();
    }
}
