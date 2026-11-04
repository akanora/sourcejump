// Where the zone editor's camera starts: a spawn point, unless the map hides its spawns in a dark room.
import { type ReadonlyVec3, vec3 } from "gl-matrix";
import {
  type BSPEntity,
  type BSPFile,
  type BSPLeaf,
  BSPLeafContents,
} from "../../replays/viewer/noclip/SourceEngine/BSPFile";

/** A standing player's eye, above the spawn's origin at their feet. */
const EYE_HEIGHT = 64;

export interface StartView {
  eye: vec3;
  /** Radians, as Source's yaw: 0 looks along +x. */
  yaw: number;
}

/**
 * Many bhop maps spawn players in a sealed, unlit room and teleport them to the start at once, so the first
 * spawn can show nothing but black (bhop_lego, bhop_null). Spawns come first, then teleport destinations, and
 * the first one standing in light wins. When none does, the lit spot nearest the first spawn is used.
 */
export function startView(bsp: BSPFile): StartView {
  const candidates = [
    ...bsp.entities.filter((entity) =>
      /^info_player_(counterterrorist|terrorist|start)$/.test(entity.classname),
    ),
    ...bsp.entities.filter(
      (entity) => entity.classname === "info_teleport_destination",
    ),
  ].flatMap((entity) => {
    const view = entityView(entity);
    return view ? [view] : [];
  });
  const first = candidates[0] ?? { eye: vec3.create(), yaw: 0 };
  // A map compiled without lighting has no light anywhere, and the renderer draws it fullbright.
  if (!bsp.leaflist.some(isLit)) return first;

  const lit = candidates.find((view) => {
    const leaf = bsp.queryPoint(view.eye);
    return leaf !== null && isLit(leaf);
  });
  if (lit) return lit;
  const nearest = nearestLitSample(bsp, first.eye);
  return nearest ? { eye: nearest, yaw: first.yaw } : first;
}

function entityView(entity: BSPEntity): StartView | null {
  if (!entity.origin) return null;
  const [x = 0, y = 0, z = 0] = entity.origin.split(" ").map(Number);
  const yaw = ((Number(entity.angles?.split(" ")[1]) || 0) * Math.PI) / 180;
  return { eye: vec3.fromValues(x, y, z + EYE_HEIGHT), yaw };
}

/** Open space that sees the sky or holds any light. A leaf without samples is given the benefit of the doubt. */
function isLit(leaf: BSPLeaf): boolean {
  if (leaf.contents & BSPLeafContents.Solid) return false;
  if (leaf.hasSkyFace || leaf.ambientLightSamples.length === 0) return true;
  return leaf.ambientLightSamples.some((sample) =>
    sample.ambientCube.some((color) => color.r + color.g + color.b > 0),
  );
}

/** The ambient light sample, in a lit leaf, closest to `point`: a spot known to be in open space. */
function nearestLitSample(bsp: BSPFile, point: ReadonlyVec3): vec3 | null {
  let best: vec3 | null = null;
  let bestDistance = Infinity;
  for (const leaf of bsp.leaflist) {
    if (!isLit(leaf)) continue;
    for (const sample of leaf.ambientLightSamples) {
      const distance = vec3.squaredDistance(sample.pos, point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = vec3.clone(sample.pos);
      }
    }
  }
  return best;
}
