// A map's Manage view, under its header (whose banner carries the image controls): the description, the
// release and each track's tier (`manage_maps`), its zones (`manage_zones`), its file for the 3D view (either),
// and the staff log about the map. Any valid map name works, so staff can set a map up before its first run.
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { trackName } from "@/features/runs/time";
import { Badge } from "@/ui/Badge";
import { Card, Label } from "@/ui/Card";
import { DividedList } from "@/ui/Divided";
import { EntryList } from "../EntryList";
import { ReadFailure } from "../ReadFailure";
import { readAsStaff } from "../staffApi";
import { DescriptionForm } from "./DescriptionForm";
import { ImagesCard } from "./ImagesCard";
import { ReleaseForm } from "./ReleaseForm";
import { TierPicker } from "./TierPicker";
import { ViewerFileCard } from "./ViewerFileCard";
import { ZoneSets } from "./ZoneSets";
import { getStaffMap } from "./staffMap";
import { zoneTypes } from "./zones";

export async function ManageMap({ name }: { name: string }) {
  const [result, log, me] = await Promise.all([
    getStaffMap(name),
    readAsStaff((headers) =>
      api.GET("/v1/staff/maps/{map}/log", {
        params: { path: { map: name } },
        headers,
      }),
    ),
    signedInPlayer(),
  ]);
  if (!("data" in result)) return <ReadFailure failure={result} />;
  const map = result.data;
  const may = (privilege: "manage_maps" | "manage_zones") =>
    me?.privileges.includes(privilege) ?? false;
  const zonesInForce = map.zone_sets[0]?.zones ?? [];

  return (
    <>
      {may("manage_maps") && map.known && (
        <Section
          title="Images"
          hint="Up to 10 pictures, shown whole when the banner is clicked. The first is the cover: the banner and the picture in lists."
        >
          <ImagesCard map={map.name} images={map.images} />
        </Section>
      )}

      {may("manage_maps") && map.known && (
        <Section
          title="Description"
          hint="Shown on the map page, as plain text."
        >
          <DescriptionForm map={map.name} description={map.description} />
        </Section>
      )}

      {may("manage_maps") && map.known && (
        <Section
          title="Release"
          hint="Shown under the map's name. Give as much of the date as is known; leave the rest unknown. The mapper's name links to their profile."
        >
          <ReleaseForm
            map={map.name}
            released={map.released}
            mapper={map.mapper}
          />
        </Section>
      )}

      <Section
        title="Tracks"
        hint={
          map.tier_count == null
            ? "The zones each track has. Tiers come once the community decides how many there are."
            : "The zones each track has, and its tier. Picking a tier saves it."
        }
      >
        <DividedList as="ul">
          {map.tracks.map((track) => (
            <li
              key={track.track}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{trackName(track.track)}</span>
                <ZoneBadges zones={zoneTypes(zonesInForce, track.track)} />
              </span>
              {may("manage_maps") && map.known && map.tier_count != null && (
                <TierPicker
                  map={map.name}
                  track={track}
                  tierCount={map.tier_count}
                />
              )}
            </li>
          ))}
        </DividedList>
      </Section>

      {may("manage_zones") && (
        <Section
          title="Zone sets"
          hint="Servers load the newest set on map start. Without zones, servers don't submit runs on the map."
        >
          <ZoneSets map={map.name} versions={map.zone_sets} />
        </Section>
      )}

      {(may("manage_maps") || may("manage_zones")) && (
        <Section
          title="3D map file"
          hint="The map as the replay viewer and the zone editor load it: stripped of what they don't use, and compressed. Your browser packs it from the game's map file and uploads the result."
        >
          <ViewerFileCard map={map.name} viewerFile={map.viewer_file} />
        </Section>
      )}

      <Section
        title="Staff log"
        hint="Tiers, images, description, release, zones and the 3D map file, newest first."
      >
        {!("data" in log) ? (
          <ReadFailure failure={log} />
        ) : (
          <EntryList
            key={log.data.entries[0]?.id ?? 0}
            about={{ map: map.name }}
            first={log.data}
            empty="No staff action has been taken on this map."
          />
        )}
      </Section>
    </>
  );
}

/** "start", "end", "checkpoint ×4": the track's zones by type, or a warning when it has none. */
function ZoneBadges({ zones }: { zones: [string, number][] }) {
  if (zones.length === 0) {
    return <Badge tone="warning">No zones</Badge>;
  }
  return (
    <>
      {zones.map(([type, count]) => (
        <Badge
          key={type}
          tone={
            type === "start" ? "success" : type === "end" ? "danger" : undefined
          }
        >
          {count > 1 ? `${type} ×${count}` : type}
        </Badge>
      ))}
    </>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label>{title}</Label>
        <p className="text-text-muted text-sm">{hint}</p>
      </div>
      {children}
    </Card>
  );
}
