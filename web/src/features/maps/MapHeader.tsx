// The top of a map's pages: its banner, name and main tier, when it was released and who made it, and the
// Map / Zones switch (with Manage for staff). It sits in the map's layout, so switching between the views leaves it in place.
import { notFound } from "next/navigation";
import type { Schemas } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { CoverControls } from "@/features/staff/maps/CoverControls";
import { getStaffMap } from "@/features/staff/maps/staffMap";
import { Link } from "@/ui/Link";
import { PathTabs } from "@/ui/PathTabs";
import { TierBadge } from "@/ui/TierBadge";
import { MapBanner } from "./MapBanner";
import { getMap } from "./mapDetail";
import { formatReleaseDate, releaseDateTime } from "./releaseDate";

export async function MapHeader({ name }: { name: string }) {
  const [result, me] = await Promise.all([getMap(name), signedInPlayer()]);
  const status = result?.response.status;
  if (status === 422) notFound();
  const map = result?.data;
  const manager = managesMaps(me?.privileges);
  if (!map && status === 404 && !manager) notFound();
  // A map without runs has no public page; staff still manage it, so its picture and tier come from their read.
  const staffResult = manager && !map ? await getStaffMap(name) : undefined;
  const staffMap =
    staffResult && "data" in staffResult ? staffResult.data : undefined;

  const images = map?.images ?? staffMap?.images ?? [];
  const cover = images[0];
  const tracks = map?.tracks ?? staffMap?.tracks ?? [];
  const tierCount = map?.tier_count ?? staffMap?.tier_count;
  const mainTier = tracks.find((t) => t.track === 0)?.tier;
  const canEdit =
    (me?.privileges.includes("manage_maps") ?? false) &&
    (map !== undefined || staffMap?.known === true);

  return (
    <>
      <MapBanner map={map?.name ?? name} images={images}>
        {canEdit && cover && <CoverControls map={name} cover={cover} />}
      </MapBanner>
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{map?.name ?? name}</h1>
          {mainTier != null && tierCount != null && (
            <TierBadge tier={mainTier} tierCount={tierCount} />
          )}
          {/* A map without a finished run has no page to switch to. */}
          {map && (
            <PathTabs
              label="View"
              className="ml-auto"
              tabs={[
                { href: `/maps/${map.name}`, label: "Map" },
                { href: `/maps/${map.name}/zones`, label: "Zones" },
                ...(manager
                  ? [{ href: `/maps/${map.name}/manage`, label: "Manage" }]
                  : []),
              ]}
            />
          )}
        </div>
        <p className="text-text-muted text-sm">
          <Details map={map} staffMap={staffMap} />
        </p>
      </header>
    </>
  );
}

function Details({
  map,
  staffMap,
}: {
  map: Schemas["MapDetail"] | undefined;
  staffMap: Schemas["StaffMap"] | undefined;
}) {
  if (!map) {
    if (!staffMap) return null;
    return staffMap.known
      ? "Not on the map list until someone finishes a run on it."
      : "SourceJump hasn't seen this map yet. Publishing zones adds it.";
  }
  if (!map.created_at) return "Known from pre-2.0 records; no 2.0 runs yet.";
  return (
    <>
      {map.released ? (
        <>
          Released{" "}
          <time dateTime={releaseDateTime(map.released)}>
            {formatReleaseDate(map.released)}
          </time>
        </>
      ) : (
        "Release date unknown"
      )}
      {" · "}
      {map.mapper ? (
        <>
          Made by{" "}
          <Link
            href={`/players/${map.mapper.steamid64}`}
            className="text-text hover:text-accent transition-colors duration-(--duration-fast)"
          >
            {map.mapper.name}
          </Link>
        </>
      ) : (
        "Mapper unknown"
      )}
    </>
  );
}

/** Who sees the Manage view: staff who rate, picture or zone maps. The API checks each privilege again. */
export function managesMaps(
  privileges: readonly Schemas["Privilege"][] | undefined,
): boolean {
  return (
    privileges?.some((p) => p === "manage_maps" || p === "manage_zones") ??
    false
  );
}
