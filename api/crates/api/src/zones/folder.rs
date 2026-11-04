//! Importing a folder of shavit zones files at once, `sourcejump-api zones import-folder`: one `<map>.json` per
//! map, as zone collections such as zones-cstrike keep them. It seeds maps without zones and never replaces a
//! zone set staff have published, so a rerun only adds what is still missing.

use std::{collections::HashSet, path::Path};

use sqlx::PgPool;

use super::{Zone, check, parse};
use crate::{maps::MapName, staff::maps::publish_zones};

/// What an import did, or with a dry run would do, file by file.
#[derive(Debug, Default)]
pub struct Report {
    /// Maps given their first zone set.
    pub imported: Vec<String>,
    /// Files left alone: the file's name and why.
    pub skipped: Vec<(String, String)>,
}

/// Publishes each file's zones as its map's first zone set, logged with `note` like any staff publish, so each
/// map's own history says where its zones came from. A map that has zones, or a file the import would refuse,
/// is skipped and reported. With `dry_run`, nothing is written.
pub async fn import_folder(
    db: &PgPool,
    folder: &Path,
    note: &str,
    dry_run: bool,
) -> Result<Report, Box<dyn std::error::Error>> {
    let mut files: Vec<_> = std::fs::read_dir(folder)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<_, _>>()?;
    files.retain(|path| path.extension().is_some_and(|ext| ext == "json"));
    files.sort();

    let already_zoned: HashSet<String> = sqlx::query_scalar!(
        "SELECT DISTINCT m.name FROM map_zones z JOIN maps m ON m.id = z.map_id"
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .collect();
    let mut seen = HashSet::new();
    let mut report = Report::default();

    for path in files {
        let file = path
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
        let skip = |report: &mut Report, why: String| report.skipped.push((file.clone(), why));
        let stem = path
            .file_stem()
            .map_or_else(String::new, |stem| stem.to_string_lossy().into_owned());
        let map = match MapName::try_from(stem) {
            Ok(map) => map,
            Err(why) => {
                skip(&mut report, why);
                continue;
            }
        };
        // Map names are lowercase, so `Bhop_X.json` and `bhop_x.json` would be the same map.
        if !seen.insert(map.as_str().to_owned()) {
            skip(&mut report, "another file names the same map".into());
            continue;
        }
        if already_zoned.contains(map.as_str()) {
            skip(&mut report, "the map already has zones".into());
            continue;
        }
        let zones = match std::fs::read_to_string(&path)
            .map_err(|error| error.to_string())
            .and_then(|json| parse(&json))
            .map(renumber)
        {
            Ok(zones) => zones,
            Err(why) => {
                skip(&mut report, why);
                continue;
            }
        };
        if let Err(why) = check(&zones) {
            skip(&mut report, why);
            continue;
        }
        if !dry_run {
            publish_zones(db, None, &map, None, &zones, Some(note))
                .await
                .map_err(|error| format!("{}: not published: {error:?}", map.as_str()))?;
        }
        report.imported.push(map.as_str().to_owned());
    }
    Ok(report)
}

/// Numbers the zones 1, 2, 3… when they share IDs. Some dumps give every zone on a map one ID, and the zone
/// editor tells zones of a type apart by it. Distinct IDs are kept as they are.
fn renumber(mut zones: Vec<Zone>) -> Vec<Zone> {
    let distinct: HashSet<i64> = zones.iter().map(|zone| zone.id).collect();
    if distinct.len() < zones.len() {
        for (id, zone) in (1..).zip(zones.iter_mut()) {
            zone.id = id;
        }
    }
    zones
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::{Value, json};
    use sqlx::PgPool;

    use super::import_folder;
    use crate::test_client;

    fn zone(kind: &str, id: i64) -> Value {
        json!({ "type": kind, "track": 0, "id": id, "point_a": [0.0, 0.0, 0.0], "point_b": [64.0, 64.0, 64.0] })
    }

    #[sqlx::test]
    async fn seeds_maps_without_zones_and_reports_the_rest(db: PgPool) {
        let folder = std::env::temp_dir().join(format!("sj-zones-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let write = |name: &str, body: &str| fs::write(folder.join(name), body).unwrap();
        let shared_ids = json!([zone("start", 7), zone("end", 7)]).to_string();
        write("bhop_new.json", &shared_ids);
        write("bhop_empty.json", "");
        write("bhop_no_end.json", &json!([zone("start", 1)]).to_string());
        write("bhop_bad name.json", &shared_ids);
        write("notes.txt", "not a zones file");

        let dry = import_folder(&db, &folder, "seed", true).await.unwrap();
        assert_eq!(dry.imported, ["bhop_new"]);
        assert_eq!(dry.skipped.len(), 3);
        assert_eq!(
            test_client::get(&db, "/v1/maps/bhop_new/zones")
                .await
                .status,
            404
        );

        let done = import_folder(&db, &folder, "seed", false).await.unwrap();
        assert_eq!(done.imported, ["bhop_new"]);
        let zones: Value = test_client::get(&db, "/v1/maps/bhop_new/zones")
            .await
            .json();
        let ids: Vec<_> = zones
            .as_array()
            .unwrap()
            .iter()
            .map(|z| z["id"].clone())
            .collect();
        assert_eq!(ids, [json!(1), json!(2)]);

        // A rerun leaves the zones staff now own alone.
        let again = import_folder(&db, &folder, "seed", false).await.unwrap();
        assert_eq!(again.imported, Vec::<String>::new());
        assert!(
            again
                .skipped
                .iter()
                .any(|(file, why)| file == "bhop_new.json" && why == "the map already has zones")
        );
        fs::remove_dir_all(&folder).unwrap();
    }
}
