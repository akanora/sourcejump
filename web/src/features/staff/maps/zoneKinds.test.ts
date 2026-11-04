// The zone types the editor draws and the values they carry.
import { describe, expect, it } from "vitest";
import { decodeValue, encodeValue, missingValues, zoneKind } from "./zoneKinds";
import { withZone } from "./zoneTool";

describe("zone values", () => {
  it("stores decimals as a float's bits and whole numbers as they are, as shavit does", () => {
    // shavit's default gravity, view_as<int>(1.0).
    expect(encodeValue(1, true)).toBe(0x3f800000);
    expect(decodeValue(encodeValue(0.5, true), true)).toBe(0.5);
    expect(encodeValue(350, false)).toBe(350);
  });

  it("numbers a new stage after the track's highest", () => {
    const zones = [
      { type: "stage", track: 0, id: 1, data: 1 },
      { type: "stage", track: 0, id: 2, data: 2 },
      { type: "stage", track: 1, id: 3, data: 5 },
    ];
    const initial = zoneKind("stage").value!.initial!;
    expect(initial(zones, 0)).toBe(3);
    expect(initial(zones, 2)).toBe(1);
  });

  it("holds back a value zone with no value", () => {
    expect(missingValues([{ type: "airaccel", track: 0, id: 1 }])).toEqual([
      "Air accelerate needs its sv_airaccelerate.",
    ]);
    expect(missingValues([{ type: "slay", track: 0, id: 1 }])).toEqual([]);
  });

  it("keeps types it doesn't know by name", () => {
    expect(zoneKind("future").label).toBe("future");
  });
});

describe("zones with a point", () => {
  const box = { min: [0, 0, 0], max: [32, 32, 32] } as const;

  it("stores a teleport's target and a spawn as dest", () => {
    const [teleport] = withZone(
      [],
      "teleport",
      0,
      { box, point: [100, 0, 0] },
      null,
    );
    expect(teleport).toMatchObject({ point_a: [0, 0, 0], dest: [100, 0, 0] });
    const [spawn] = withZone(
      [],
      "customspawn",
      1,
      { box: null, point: [5, 5, 5] },
      null,
    );
    expect(spawn).toEqual({
      type: "customspawn",
      track: 1,
      id: 1,
      dest: [5, 5, 5],
    });
  });
});
