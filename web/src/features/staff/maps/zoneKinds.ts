// The zone types the editor draws, as shavit's zone menu offers them (shavit/zones.inc, shavit-zones.sp): what
// each is called, what's placed for it, and the value it carries in `data`. Which types a map should have is the
// community's and the mapper's call; the editor only draws them.
import type { Zone } from "./zones";

/** What's placed: a box; a box and the point it sends players to; or only a point. */
export type ZoneShape = "box" | "box-destination" | "point";

/** A value stored in `data`: whole numbers as they are, decimals as a float's bits, as shavit stores them. */
export interface ZoneValue {
  label: string;
  decimal: boolean;
  /** The value a new zone starts with; none means it must be entered. */
  initial: ((zones: Zone[], track: number) => number) | null;
  hint: string;
}

export interface ZoneKind {
  type: string;
  label: string;
  shape: ZoneShape;
  value?: ZoneValue;
}

const multiplier = (label: string): ZoneValue => ({
  label,
  decimal: true,
  initial: () => 1,
  hint: "1 is normal.",
});

export const ZONE_KINDS: ZoneKind[] = [
  { type: "start", label: "Start", shape: "box" },
  { type: "end", label: "End", shape: "box" },
  {
    type: "stage",
    label: "Stage",
    shape: "box",
    value: {
      label: "Stage",
      decimal: false,
      // The track's next stage, as shavit numbers them.
      initial: (zones, track) =>
        Math.max(
          0,
          ...zones
            .filter((zone) => zone.type === "stage" && zone.track === track)
            .map((zone) => zone.data ?? 0),
        ) + 1,
      hint: "1 to 69, in the order players reach them.",
    },
  },
  { type: "respawn", label: "Glitch: respawn", shape: "box" },
  { type: "stop", label: "Glitch: stop timer", shape: "box" },
  { type: "slay", label: "Slay", shape: "box" },
  { type: "teleport", label: "Teleport", shape: "box-destination" },
  { type: "customspawn", label: "Spawn", shape: "point" },
  { type: "freestyle", label: "Freestyle", shape: "box" },
  {
    type: "customspeedlimit",
    label: "Speed limit",
    shape: "box",
    value: {
      label: "Units per second",
      decimal: false,
      initial: () => 0,
      hint: "0 is unlimited.",
    },
  },
  { type: "easybhop", label: "Easybhop", shape: "box" },
  { type: "autobhop", label: "Autobhop", shape: "box" },
  { type: "nojump", label: "No jump", shape: "box" },
  { type: "slide", label: "Slide", shape: "box" },
  {
    type: "airaccel",
    label: "Air accelerate",
    shape: "box",
    value: {
      label: "sv_airaccelerate",
      decimal: false,
      initial: null,
      hint: "The server's sv_airaccelerate inside the zone.",
    },
  },
  {
    type: "gravity",
    label: "Gravity",
    shape: "box",
    value: multiplier("Gravity"),
  },
  {
    type: "speedmod",
    label: "Speedmod",
    shape: "box",
    value: multiplier("Speed"),
  },
  { type: "notimergravity", label: "No timer gravity", shape: "box" },
];

/** What the editor knows about a zone's type; types it doesn't draw are kept and shown by name. */
export function zoneKind(type: string): ZoneKind {
  return (
    ZONE_KINDS.find((kind) => kind.type === type) ?? {
      type,
      label: type,
      shape: "box",
    }
  );
}

const scratch = new DataView(new ArrayBuffer(4));

/** A value as stored in `data`. */
export function encodeValue(value: number, decimal: boolean): number {
  if (!decimal) return Math.round(value);
  scratch.setFloat32(0, value);
  return scratch.getInt32(0);
}

/** `data` as the value it holds. */
export function decodeValue(data: number, decimal: boolean): number {
  if (!decimal) return data;
  scratch.setInt32(0, data);
  return Math.round(scratch.getFloat32(0) * 1000) / 1000;
}

/** Why the zones can't be published as they are: value zones with no value yet. */
export function missingValues(zones: Zone[]): string[] {
  return zones.flatMap((zone) => {
    const kind = zoneKind(zone.type);
    return kind.value && zone.data == null
      ? [`${kind.label} needs its ${kind.value.label.toLowerCase()}.`]
      : [];
  });
}
