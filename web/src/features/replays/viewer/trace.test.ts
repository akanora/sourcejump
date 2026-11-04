// Tracing a ray to the first solid brush of a map.
import { describe, expect, it } from "vitest";
import { Plane } from "./noclip/Geometry";
import type { BSPEntity, BSPFile } from "./noclip/SourceEngine/BSPFile";
import { traceSolid } from "./trace";

const SOLID = 0x1;
const DETAIL = 0x8000000;
const PLAYER_CLIP = 0x10000;

type Vec = [number, number, number];
type Brush = { min: Vec; max: Vec; contents: number };

/** A small map of axis-aligned brushes. Each model's tree is one split at x = 0 into two leaves. */
function map(
  models: { brushes: Brush[] }[],
  entities: BSPEntity[] = [],
): BSPFile {
  const brushes: number[] = [];
  const brushSides: number[] = [];
  const planes: number[] = [];
  const nodelist = [];
  const leaflist = [];
  for (const [index, model] of models.entries()) {
    const ids: number[] = [];
    for (const { min, max, contents } of model.brushes) {
      ids.push(brushes.length / 3);
      brushes.push(brushSides.length / 4, 6, contents);
      for (let axis = 0; axis < 3; axis++) {
        for (const sign of [1, -1]) {
          const normal: Vec = [0, 0, 0];
          normal[axis] = sign;
          brushSides.push(planes.length / 5, 0, 0, 0);
          planes.push(...normal, sign * (sign > 0 ? max : min)[axis]!, axis);
        }
      }
    }
    // Every brush in both leaves: enough for the walk, which tests each brush once.
    nodelist.push({
      plane: new Plane(1, 0, 0, 0),
      child0: -(index * 2 + 1),
      child1: -(index * 2 + 2),
    });
    for (let i = 0; i < 2; i++)
      leaflist.push({ contents: 0, brushes: Uint16Array.from(ids) });
  }
  return {
    collision: {
      brushes: Int32Array.from(brushes),
      brushSides: Uint16Array.from(brushSides),
      planes: Float32Array.from(planes),
    },
    nodelist,
    leaflist,
    models: models.map((_, index) => ({ headnode: index })),
    entities,
  } as unknown as BSPFile;
}

// A floor at z = 0 with a func_detail block standing on it, and a player clip above the block.
const world = {
  brushes: [
    { min: [-1000, -1000, -16], max: [1000, 1000, 0], contents: SOLID },
    { min: [100, -50, 0], max: [200, 50, 64], contents: SOLID | DETAIL },
    { min: [100, -50, 128], max: [200, 50, 256], contents: PLAYER_CLIP },
  ] satisfies Brush[],
};
// A box 32 high around its entity's origin, as a door or a trigger would be.
const box = {
  brushes: [
    { min: [-32, -32, 0], max: [32, 32, 32], contents: SOLID },
  ] satisfies Brush[],
};

describe("traceSolid", () => {
  it("finds where a ray meets the floor, and which way the floor faces", () => {
    const hit = traceSolid(map([world]), [-300, 20, 100], [-300, 20, -100]);
    expect(hit && [...hit.point]).toEqual([-300, 20, 0]);
    expect(hit && [...hit.normal]).toEqual([0, 0, 1]);
  });

  it("stops at a detail brush's top", () => {
    const hit = traceSolid(map([world]), [150, 0, 200], [150, 0, -100]);
    expect(hit && [...hit.point]).toEqual([150, 0, 64]);
  });

  it("stops at a detail brush's side", () => {
    const hit = traceSolid(map([world]), [0, 0, 32], [300, 0, 32]);
    expect(hit && [...hit.point]).toEqual([100, 0, 32]);
    expect(hit && [...hit.normal]).toEqual([-1, 0, 0]);
  });

  it("passes through player clips, which nobody sees", () => {
    const hit = traceSolid(map([world]), [150, 0, 300], [150, 0, -100]);
    expect(hit && [...hit.point]).toEqual([150, 0, 64]);
  });

  it("passes through a brush it starts inside", () => {
    const hit = traceSolid(map([world]), [150, 0, 32], [150, 0, -100]);
    expect(hit && [...hit.point]).toEqual([150, 0, 0]);
  });

  it("finds nothing for a ray that stays in the air", () => {
    expect(traceSolid(map([world]), [0, 0, 100], [500, 0, 50])).toBeNull();
  });

  it("stops at a solid brush entity where it stands, and passes through triggers", () => {
    const bsp = map(
      [world, box, box],
      [
        { classname: "func_door", model: "*1", origin: "-500 0 0" },
        { classname: "trigger_teleport", model: "*2", origin: "-700 0 0" },
      ],
    );
    const door = traceSolid(bsp, [-500, 0, 200], [-500, 0, -100]);
    expect(door && [...door.point]).toEqual([-500, 0, 32]);
    const trigger = traceSolid(bsp, [-700, 0, 200], [-700, 0, -100]);
    expect(trigger && [...trigger.point]).toEqual([-700, 0, 0]);
  });
});
