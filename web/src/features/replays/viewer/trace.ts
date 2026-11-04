// Where a ray first meets the map's solid brushes, for aiming at the floor. Walks the BSP tree front to back as
// Source's own traces do and clips the ray against the brushes each leaf lists; noclip's traceLine says only
// whether something was hit, not where.
import { type ReadonlyVec3, vec3 } from "gl-matrix";
import type { BSPCollision, BSPFile } from "./noclip/SourceEngine/BSPFile";

export interface TraceHit {
  point: vec3;
  /** The surface's normal, facing back along the ray. */
  normal: vec3;
}

/** Source's MASK_SOLID: solid, window, grate, moveable and monster brushes. Player clips are invisible, so the
 * aim passes through them. */
const MASK_SOLID = 0x1 | 0x2 | 0x8 | 0x4000 | 0x2000000;

/** Brush entities a player can't stand on, or that nobody sees. */
const NOT_SOLID =
  /^(trigger_.*|func_(illusionary|areaportal|areaportalwindow|occluder|viscluster|buyzone|bomb_target|hostage_rescue|precipitation|dustmotes|dustcloud|smokevolume|ladder|clip_vphysics|water_analog|fish_pool))$/;

interface SolidModel {
  headnode: number;
  origin: vec3;
}

/** Per map: the world, then each solid brush entity, as a tree to walk and where it stands. */
const solidModels = new WeakMap<BSPFile, SolidModel[]>();

/** The first solid point on the segment from `start` to `end`, or null when it stays in open space. Brushes the
 * segment starts inside are passed through, so a camera inside one still aims at what lies beyond it. */
export function traceSolid(
  bsp: BSPFile,
  start: ReadonlyVec3,
  end: ReadonlyVec3,
): TraceHit | null {
  const collision = bsp.collision;
  if (!collision || bsp.nodelist.length === 0) return null;
  let best: { fraction: number; normal: vec3 } | null = null;
  for (const model of modelsOf(bsp)) {
    const from = vec3.sub(vec3.create(), start, model.origin);
    const to = vec3.sub(vec3.create(), end, model.origin);
    const hit = traceModel(bsp, collision, model.headnode, from, to);
    if (hit && (!best || hit.fraction < best.fraction)) best = hit;
  }
  if (!best) return null;
  return {
    point: vec3.lerp(vec3.create(), start, end, best.fraction),
    normal: best.normal,
  };
}

function modelsOf(bsp: BSPFile): SolidModel[] {
  let models = solidModels.get(bsp);
  if (models) return models;
  models = [{ headnode: bsp.models[0]?.headnode ?? 0, origin: vec3.create() }];
  for (const entity of bsp.entities) {
    if (!entity.model?.startsWith("*") || NOT_SOLID.test(entity.classname))
      continue;
    // func_brush's "Never Solid".
    if (entity.classname === "func_brush" && entity.solidity === "1") continue;
    const model = bsp.models[Number(entity.model.slice(1))];
    if (!model || model.headnode === 0) continue;
    // Moved by its origin only: rotated brush entities are rare on bhop maps, and doors' angles are where
    // they open towards, not a turn of the brush.
    const [x = 0, y = 0, z = 0] = (entity.origin ?? "").split(" ").map(Number);
    models.push({ headnode: model.headnode, origin: vec3.fromValues(x, y, z) });
  }
  solidModels.set(bsp, models);
  return models;
}

/** The nearest brush the segment enters in one model's tree, as a fraction along it. */
function traceModel(
  bsp: BSPFile,
  collision: BSPCollision,
  headnode: number,
  start: ReadonlyVec3,
  end: ReadonlyVec3,
): { fraction: number; normal: vec3 } | null {
  const tested = new Set<number>();
  let best: { fraction: number; normal: vec3 } | null = null;
  const at = (fraction: number) =>
    vec3.lerp(vec3.create(), start, end, fraction);

  // Front to back over the stretch [t0, t1]; true once nothing further along can be nearer.
  const visit = (nodeId: number, t0: number, t1: number): boolean => {
    if (nodeId < 0) {
      const leaf = bsp.leaflist[-nodeId - 1];
      for (const brush of leaf?.brushes ?? []) {
        if (tested.has(brush)) continue;
        tested.add(brush);
        const hit = clipBrush(collision, brush, start, end);
        if (hit && (!best || hit.fraction < best.fraction)) best = hit;
      }
      // A brush can reach past this leaf, so a hit only ends the walk once it lies within it.
      return best !== null && best.fraction <= t1;
    }
    const node = bsp.nodelist[nodeId]!;
    const d0 = node.plane.distanceVec3(at(t0));
    const d1 = node.plane.distanceVec3(at(t1));
    if (d0 >= 0 && d1 >= 0) return visit(node.child0, t0, t1);
    if (d0 < 0 && d1 < 0) return visit(node.child1, t0, t1);
    const [near, far] =
      d0 >= 0 ? [node.child0, node.child1] : [node.child1, node.child0];
    const mid = t0 + (t1 - t0) * (d0 / (d0 - d1));
    return visit(near, t0, mid) || visit(far, mid, t1);
  };
  visit(headnode, 0, 1);
  return best;
}

/** Where the segment enters a convex brush: the last of its planes it crosses inwards, if it is inside all of
 * them by then. */
function clipBrush(
  { brushes, brushSides, planes }: BSPCollision,
  brush: number,
  start: ReadonlyVec3,
  end: ReadonlyVec3,
): { fraction: number; normal: vec3 } | null {
  const firstSide = brushes[brush * 3]!;
  const sideCount = brushes[brush * 3 + 1]!;
  const contents = brushes[brush * 3 + 2]!;
  if (!(contents & MASK_SOLID)) return null;

  let enter = -Infinity;
  let exit = 1;
  let enterPlane = -1;
  for (let side = firstSide; side < firstSide + sideCount; side++) {
    const plane = brushSides[side * 4]! * 5;
    const [nx = 0, ny = 0, nz = 0, dist = 0] = planes.subarray(
      plane,
      plane + 4,
    );
    const d0 = nx * start[0] + ny * start[1] + nz * start[2] - dist;
    const d1 = nx * end[0] + ny * end[1] + nz * end[2] - dist;
    // Wholly outside one plane: the segment misses the brush.
    if (d0 > 0 && d1 > 0) return null;
    if (d0 <= 0 && d1 <= 0) continue;
    const fraction = d0 / (d0 - d1);
    if (d0 > 0) {
      if (fraction > enter) {
        enter = fraction;
        enterPlane = plane;
      }
    } else exit = Math.min(exit, fraction);
  }
  // No plane crossed inwards: the segment starts inside the brush.
  if (enterPlane < 0 || enter > exit) return null;
  return {
    fraction: enter,
    normal: vec3.fromValues(
      planes[enterPlane]!,
      planes[enterPlane + 1]!,
      planes[enterPlane + 2]!,
    ),
  };
}
