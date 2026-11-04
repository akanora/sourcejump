// Zone sets for a map's Manage view: reading a pasted shavit file, laying zones out from above, what changed,
// and each track's zones by type.
import type { Schemas } from "@/api/client";

export type Zone = Schemas["Zone"];

/** A zone as a rectangle seen from above, in map units, with y pointing north. */
export type ZoneBox = {
  zone: Zone;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** The zones that have a box; teleport destinations and the like have no area to draw. */
export function boxes(zones: Zone[]): ZoneBox[] {
  return zones.flatMap((zone) => {
    const [ax, ay] = zone.point_a ?? [];
    const [bx, by] = zone.point_b ?? [];
    if (ax === undefined || ay === undefined) return [];
    if (bx === undefined || by === undefined) return [];
    return [
      {
        zone,
        minX: Math.min(ax, bx),
        minY: Math.min(ay, by),
        maxX: Math.max(ax, bx),
        maxY: Math.max(ay, by),
      },
    ];
  });
}

/** Reads a pasted shavit-zones-json file; the API checks it fully when publishing. */
export function parseZones(text: string): Zone[] | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "This isn't JSON. Paste the whole shavit zones file.";
  }
  if (!Array.isArray(value) || value.length === 0) {
    return "A shavit zones file is a list of zones.";
  }
  const zones = value as Zone[];
  if (
    zones.some(
      (zone) =>
        typeof zone?.type !== "string" ||
        typeof zone.track !== "number" ||
        typeof zone.id !== "number",
    )
  ) {
    return "Every zone needs a type, a track and an id.";
  }
  return zones;
}

/** What a zone is called in the change list: its type, and its track when it's a bonus. */
export function zoneName(zone: Zone): string {
  return zone.track === 0 ? zone.type : `${zone.type} (bonus ${zone.track})`;
}

/** Zones added, removed or changed between two sets, matched by type, track and id. */
export function zoneChanges(before: Zone[], after: Zone[]): string[] {
  const key = (zone: Zone) => `${zone.type}/${zone.track}/${zone.id}`;
  const old = new Map(before.map((zone) => [key(zone), zone]));
  const changes: string[] = [];
  for (const zone of after) {
    const previous = old.get(key(zone));
    if (!previous) changes.push(`Added ${zoneName(zone)}`);
    else if (JSON.stringify(previous) !== JSON.stringify(zone)) {
      changes.push(`Changed ${zoneName(zone)}`);
    }
    old.delete(key(zone));
  }
  for (const zone of old.values()) changes.push(`Removed ${zoneName(zone)}`);
  return changes;
}

/** A track's zones by type, in the order they first appear, e.g. [["start", 1], ["checkpoint", 4]]. */
export function zoneTypes(zones: Zone[], track: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const zone of zones) {
    if (zone.track === track) {
      counts.set(zone.type, (counts.get(zone.type) ?? 0) + 1);
    }
  }
  return [...counts];
}
