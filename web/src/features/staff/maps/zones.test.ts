// Reading pasted zone files and describing what a new zone set changes.
import { describe, expect, it } from "vitest";
import { boxes, parseZones, type Zone, zoneChanges, zoneTypes } from "./zones";

const start: Zone = {
  type: "start",
  track: 0,
  id: 1,
  point_a: [64, 0, 0],
  point_b: [0, 64, 64],
};
const end: Zone = {
  type: "end",
  track: 0,
  id: 2,
  point_a: [1000, 0, 0],
  point_b: [1064, 64, 64],
};

describe("zones", () => {
  it("lays boxes out from their corners in any order", () => {
    expect(boxes([start, { type: "teleport", track: 0, id: 9 }])).toEqual([
      { zone: start, minX: 0, minY: 0, maxX: 64, maxY: 64 },
    ]);
  });

  it("explains what a pasted file is missing", () => {
    expect(parseZones("{")).toMatch(/isn't JSON/);
    expect(parseZones("{}")).toMatch(/list of zones/);
    expect(parseZones('[{"type": "start"}]')).toMatch(/type, a track/);
    expect(parseZones(JSON.stringify([start, end]))).toEqual([start, end]);
  });

  it("names added, changed and removed zones", () => {
    const moved = { ...end, point_a: [990, 0, 0] as [number, number, number] };
    const bonus = { ...start, track: 1, id: 3 };
    expect(zoneChanges([start, end], [start, moved, bonus])).toEqual([
      "Changed end",
      "Added start (bonus 1)",
    ]);
    expect(zoneChanges([start, end], [start])).toEqual(["Removed end"]);
  });

  it("counts a track's zones by type", () => {
    const bonus: Zone = { ...start, track: 1, id: 3 };
    const checkpoint = (id: number): Zone => ({
      ...start,
      type: "checkpoint",
      id,
    });
    const zones = [start, checkpoint(4), end, checkpoint(5), bonus];
    expect(zoneTypes(zones, 0)).toEqual([
      ["start", 1],
      ["checkpoint", 2],
      ["end", 1],
    ]);
    expect(zoneTypes(zones, 1)).toEqual([["start", 1]]);
    expect(zoneTypes(zones, 2)).toEqual([]);
  });
});
