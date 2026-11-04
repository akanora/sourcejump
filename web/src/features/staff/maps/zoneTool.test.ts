// Placing a zone box: corners, height, and the zone it becomes.
import { describe, expect, it } from "vitest";
import {
  adjustHeight,
  boxFrom,
  DEFAULT_HEIGHT,
  place,
  type Placing,
  previewBox,
  snapPoint,
  withZone,
  zoneBox,
} from "./zoneTool";
import type { Zone } from "./zones";

describe("placing a box", () => {
  it("takes a corner, the opposite corner, then a height", () => {
    let placing: Placing = { step: "first" };
    placing = place(placing, [0, 0, 64])!;
    expect(previewBox(placing, [256, 128, 64])).toEqual({
      min: [0, 0, 64],
      max: [256, 128, 64 + DEFAULT_HEIGHT],
    });
    placing = place(placing, [256, 128, 64])!;
    placing = adjustHeight(placing, 2, 16);
    expect(previewBox(placing, null)).toEqual({
      min: [0, 0, 64],
      max: [256, 128, 64 + DEFAULT_HEIGHT + 32],
    });
  });

  it("refuses a second corner in line with the first", () => {
    const placing = place({ step: "first" }, [0, 0, 0])!;
    expect(place(placing, [0, 300, 0])).toBeNull();
  });

  it("stands on the lower floor and never goes flat", () => {
    expect(boxFrom([0, 0, 96], [64, 64, 64], 128).min[2]).toBe(64);
    const placing: Placing = {
      step: "height",
      first: [0, 0, 0],
      second: [64, 64, 0],
      height: 16,
    };
    expect(adjustHeight(placing, -5, 16)).toMatchObject({ height: 8 });
  });

  it("snaps across the floor but keeps the floor's height", () => {
    expect(snapPoint([23.4, -9, 63.6], 16)).toEqual([16, -16, 64]);
  });
});

describe("zones", () => {
  const start: Zone = {
    type: "start",
    track: 0,
    id: 4,
    point_a: [64, 64, 0],
    point_b: [0, 0, 128],
  };
  const box = { min: [0, 0, 0], max: [32, 32, 32] } as const;

  it("reads a zone's box whichever corners it gives", () => {
    expect(zoneBox(start)).toEqual({ min: [0, 0, 0], max: [64, 64, 128] });
    expect(zoneBox({ type: "teleport", track: 0, id: 1 })).toBeNull();
  });

  it("adds a zone with the next id, or moves one in place", () => {
    expect(withZone([start], "end", 0, { box, point: null }, null)[1]).toEqual({
      type: "end",
      track: 0,
      id: 5,
      point_a: [0, 0, 0],
      point_b: [32, 32, 32],
    });
    expect(withZone([start], "end", 0, { box, point: null }, start)).toEqual([
      { ...start, point_a: [0, 0, 0], point_b: [32, 32, 32] },
    ]);
  });
});
