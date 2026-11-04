// Where the zone editor's camera starts.
import { describe, expect, it } from "vitest";
import { Plane } from "../../replays/viewer/noclip/Geometry";
import {
  type BSPEntity,
  BSPFile,
  type BSPLeaf,
} from "../../replays/viewer/noclip/SourceEngine/BSPFile";
import { startView } from "./zoneEditorStart";

const dark = { r: 0, g: 0, b: 0, a: 1 };
const light = { r: 0.4, g: 0.3, b: 0.3, a: 1 };

function leaf(color: typeof dark, pos: [number, number, number]): BSPLeaf {
  return {
    contents: 0,
    hasSkyFace: false,
    ambientLightSamples: [{ ambientCube: Array(6).fill(color), pos }],
  } as unknown as BSPLeaf;
}

// Split at x = 0: a lit room on the positive side (leaf 0), a dark one on the negative side (leaf 1).
function map(
  entities: BSPEntity[],
  positive = light,
  negative = dark,
): BSPFile {
  const bsp = Object.create(BSPFile.prototype) as BSPFile;
  Object.assign(bsp, {
    entities,
    nodelist: [{ plane: new Plane(1, 0, 0, 0), child0: -1, child1: -2 }],
    leaflist: [leaf(positive, [500, 0, 100]), leaf(negative, [-500, 0, 100])],
  });
  return bsp;
}

const spawn = (origin: string, angles = "0 90 0"): BSPEntity => ({
  classname: "info_player_terrorist",
  origin,
  angles,
});

describe("startView", () => {
  it("starts at a lit spawn, at eye height, facing its way", () => {
    const view = startView(map([spawn("100 0 0")]));
    expect([...view.eye]).toEqual([100, 0, 64]);
    expect(view.yaw).toBeCloseTo(Math.PI / 2);
  });

  it("passes over spawns in a dark room for a lit one", () => {
    const view = startView(map([spawn("-100 0 0"), spawn("200 0 0")]));
    expect([...view.eye]).toEqual([200, 0, 64]);
  });

  it("takes a lit teleport destination when every spawn is dark", () => {
    const view = startView(
      map([
        spawn("-100 0 0"),
        { classname: "info_teleport_destination", origin: "300 0 0" },
      ]),
    );
    expect([...view.eye]).toEqual([300, 0, 64]);
  });

  it("falls back to the nearest lit spot, keeping the spawn's facing", () => {
    const view = startView(map([spawn("-100 0 0")]));
    expect([...view.eye]).toEqual([500, 0, 100]);
    expect(view.yaw).toBeCloseTo(Math.PI / 2);
  });

  it("keeps the first spawn on a map without lighting", () => {
    const view = startView(map([spawn("-100 0 0")], dark, dark));
    expect([...view.eye]).toEqual([-100, 0, 64]);
  });
});
