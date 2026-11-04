// Placing a zone box the way shavit's in-game zone menu does: a corner, the opposite corner, then the height,
// and for a teleport the point it sends players to (a spawn is only that point). Pure, so the editor's 3D view
// and its panel agree on every step.
import type { Zone } from "./zones";

export type Point = readonly [number, number, number];

export interface Box {
  min: Point;
  max: Point;
}

/** shavit's default zone height (`shavit_zones_height`). */
export const DEFAULT_HEIGHT = 128;
export const GRIDS = [1, 2, 4, 8, 16] as const;
/** Lower than this, a zone can't hold a player standing in it. */
const MIN_HEIGHT = 8;

/** Where a zone is in being drawn: waiting for its box's first corner, its second, its height, or a point. */
export type Placing =
  | { step: "first" }
  | { step: "second"; first: Point }
  | { step: "height"; first: Point; second: Point; height: number }
  /** The box, when there is one, is kept while its point is placed. */
  | { step: "point"; box: Box | null };

/** What's been placed for a zone. */
export interface Placed {
  box: Box | null;
  point: Point | null;
}

export function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/** A floor point under the cursor, snapped to the grid across the floor; its height is the floor's own. */
export function snapPoint(point: Point, grid: number): Point {
  return [snap(point[0], grid), snap(point[1], grid), Math.round(point[2])];
}

/** The box two floor corners span, standing on the lower of the two floors. */
export function boxFrom(first: Point, second: Point, height: number): Box {
  const floor = Math.min(first[2], second[2]);
  return {
    min: [Math.min(first[0], second[0]), Math.min(first[1], second[1]), floor],
    max: [
      Math.max(first[0], second[0]),
      Math.max(first[1], second[1]),
      floor + height,
    ],
  };
}

/** The next step after a click on the floor at `point`, or null when the click doesn't count. */
export function place(placing: Placing, point: Point): Placing | null {
  if (placing.step === "first") return { step: "second", first: point };
  if (placing.step === "second") {
    // A box with no area on the floor is a misclick, not a zone.
    if (point[0] === placing.first[0] || point[1] === placing.first[1])
      return null;
    return {
      step: "height",
      first: placing.first,
      second: point,
      height: DEFAULT_HEIGHT,
    };
  }
  return null;
}

/** Raises or lowers the box by whole grid steps while its height is being set. */
export function adjustHeight(
  placing: Placing,
  steps: number,
  grid: number,
): Placing {
  if (placing.step !== "height") return placing;
  const height = Math.max(MIN_HEIGHT, placing.height + steps * grid);
  return { ...placing, height };
}

/** The box to draw for the current step, following the cursor until it's placed. */
export function previewBox(placing: Placing, aim: Point | null): Box | null {
  if (placing.step === "point") return placing.box;
  if (placing.step === "second")
    return aim ? boxFrom(placing.first, aim, DEFAULT_HEIGHT) : null;
  if (placing.step === "height")
    return boxFrom(placing.first, placing.second, placing.height);
  return null;
}

/** A zone's box, when it has one. */
export function zoneBox(zone: Zone): Box | null {
  const a = zone.point_a;
  const b = zone.point_b;
  if (!a || !b || a.length < 3 || b.length < 3) return null;
  return {
    min: [
      Math.min(a[0]!, b[0]!),
      Math.min(a[1]!, b[1]!),
      Math.min(a[2]!, b[2]!),
    ],
    max: [
      Math.max(a[0]!, b[0]!),
      Math.max(a[1]!, b[1]!),
      Math.max(a[2]!, b[2]!),
    ],
  };
}

/** The set with what was placed as a zone of `type` on `track`: in place of `replacing` when given, else added
 * with `data`. A point is stored as `dest`, where shavit reads a teleport's target and a spawn. */
export function withZone(
  zones: Zone[],
  type: string,
  track: number,
  placed: Placed,
  replacing: Zone | null,
  data?: number,
): Zone[] {
  const fields = {
    ...(placed.box && {
      point_a: [...placed.box.min],
      point_b: [...placed.box.max],
    }),
    ...(placed.point && { dest: [...placed.point] }),
  };
  if (replacing)
    return zones.map((zone) =>
      zone === replacing ? { ...zone, ...fields } : zone,
    );
  // shavit keys zones by id within a map, so a new one takes the next free id.
  const id = zones.reduce((highest, zone) => Math.max(highest, zone.id), 0) + 1;
  return [
    ...zones,
    { type, track, id, ...(data !== undefined && { data }), ...fields },
  ];
}
