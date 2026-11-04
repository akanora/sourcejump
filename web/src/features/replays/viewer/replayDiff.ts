// Matches the playhead to the same point on another run's route, for the HUD's time and speed deltas (from daf's
// replay viewer). Every index into the per-tick arrays is in range by construction; the `!`s say so to the strict
// index check.
import type { MovementAnalysis, RunTicks } from "./movement";

/** Segments per BVH leaf. */
const LEAF_SIZE = 16;
/** Depth guard for the traversal stack. */
const MAX_STACK = 128;

/** Local search window behind the previous match, in seconds. */
const WINDOW_BACK_SECONDS = 0.5;
/** Local search window ahead of the previous match, in seconds. */
const WINDOW_FORWARD_SECONDS = 2.5;
/** A local match this close is accepted without a global search, in units. */
const LOCAL_ACCEPT_DISTANCE = 96;
/** A global match must beat the local one by this factor to steal the lock. */
const RELOCK_ADVANTAGE = 0.5;
/** Beyond this the player is off-route and the comparison is not meaningful. */
const MAX_MATCH_DISTANCE = 512;

export interface DiffSample {
  /** Comparison run time at the matched point, in seconds. */
  time: number;
  /** Comparison horizontal speed at the matched point, in u/s. */
  speed: number;
  /** Distance from the player to the matched point, in units. */
  distance: number;
  /** False when no point on the comparison route is close enough to trust. */
  valid: boolean;
}

/**
 * Matches the current position against a comparison run, for the time and speed
 * deltas. Two things matter more than raw speed:
 *
 * 1. Every leaf AABB contains both endpoints of every segment inside it, so
 *    distance pruning can never skip the leaf holding the closest point.
 * 2. Bhop maps cross themselves and stack floors, so the spatially nearest
 *    point on the whole route is often the wrong one. Search stays in a window
 *    around the previous match and only re-locks globally when that fails.
 */
export class ReplayDiff {
  private readonly positions: Float32Array;
  private readonly speeds: Float32Array;
  private readonly startTick: number;
  private readonly endTick: number;
  private readonly tickRate: number;

  /** First point tick of each segment. Segment i spans [t, t + 1]. */
  private readonly segTick: Int32Array;
  /** Flat BVH. Interior nodes store child indices, leaves store segment spans. */
  private readonly nodeMin: Float32Array;
  private readonly nodeMax: Float32Array;
  private readonly nodeLeft: Int32Array;
  private readonly nodeRight: Int32Array;
  private readonly nodeLo: Int32Array;
  private readonly nodeHi: Int32Array;
  private nodeCount = 0;

  private readonly stack = new Int32Array(MAX_STACK);
  private bestDistSq = Infinity;
  private bestTick = 0;

  private lastMatch = -1;
  private lastSeekGeneration = -1;

  constructor(
    positions: Float32Array,
    tickRate: number,
    runTicks: RunTicks,
    analysis: MovementAnalysis,
  ) {
    this.positions = positions;
    this.speeds = analysis.horizontalSpeed;
    this.tickRate = tickRate;
    const total = positions.length / 3;
    this.startTick = Math.max(0, Math.min(runTicks.start, total - 1));
    this.endTick = Math.max(this.startTick, Math.min(runTicks.end, total - 1));

    // A segment is only valid when both of its ticks are consecutive recorded
    // positions. Teleport steps are excluded outright; otherwise a warp gets
    // drawn as a straight line through the level.
    const ticks: number[] = [];
    for (let t = this.startTick; t < this.endTick; t++) {
      if (analysis.discontinuity[t + 1]! === 1) continue;
      ticks.push(t);
    }
    this.segTick = Int32Array.from(ticks);

    // Binary halving stops at LEAF_SIZE, so the leaf count is not simply
    // ceil(n / LEAF_SIZE); count the nodes first rather than guess a capacity
    // and silently drop writes past the end of a typed array.
    const capacity = Math.max(1, countNodes(this.segTick.length, 0));
    this.nodeMin = new Float32Array(capacity * 3);
    this.nodeMax = new Float32Array(capacity * 3);
    this.nodeLeft = new Int32Array(capacity).fill(-1);
    this.nodeRight = new Int32Array(capacity).fill(-1);
    this.nodeLo = new Int32Array(capacity).fill(-1);
    this.nodeHi = new Int32Array(capacity).fill(-1);
    if (this.segTick.length > 0) this.buildNode(0, this.segTick.length, 0);
  }

  /** Bounds of every point touched by segments [lo, hi). */
  private computeBounds(lo: number, hi: number, node: number): void {
    const p = this.positions;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = lo; i < hi; i++) {
      // Both endpoints, so the leaf can never test a segment reaching outside
      // its own bounds.
      for (let e = 0; e < 2; e++) {
        const o = (this.segTick[i]! + e) * 3;
        const x = p[o]!,
          y = p[o + 1]!,
          z = p[o + 2]!;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    }
    const b = node * 3;
    this.nodeMin[b] = minX;
    this.nodeMin[b + 1] = minY;
    this.nodeMin[b + 2] = minZ;
    this.nodeMax[b] = maxX;
    this.nodeMax[b + 1] = maxY;
    this.nodeMax[b + 2] = maxZ;
  }

  private buildNode(lo: number, hi: number, depth: number): number {
    const node = this.nodeCount++;
    if (node >= this.nodeLo.length)
      throw new Error("BVH node capacity exceeded");
    this.computeBounds(lo, hi, node);
    if (hi - lo <= LEAF_SIZE || depth >= MAX_STACK - 2) {
      this.nodeLo[node] = lo;
      this.nodeHi[node] = hi;
      return node;
    }
    // Segments are already ordered along the route, so splitting the range in
    // half keeps each child temporally contiguous and spatially tight without
    // any sorting.
    const mid = (lo + hi) >> 1;
    this.nodeLeft[node] = this.buildNode(lo, mid, depth + 1);
    this.nodeRight[node] = this.buildNode(mid, hi, depth + 1);
    return node;
  }

  private nodeDistSq(node: number, x: number, y: number, z: number): number {
    const b = node * 3;
    const dx =
      x < this.nodeMin[b]!
        ? this.nodeMin[b]! - x
        : x > this.nodeMax[b]!
          ? x - this.nodeMax[b]!
          : 0;
    const dy =
      y < this.nodeMin[b + 1]!
        ? this.nodeMin[b + 1]! - y
        : y > this.nodeMax[b + 1]!
          ? y - this.nodeMax[b + 1]!
          : 0;
    const dz =
      z < this.nodeMin[b + 2]!
        ? this.nodeMin[b + 2]! - z
        : z > this.nodeMax[b + 2]!
          ? z - this.nodeMax[b + 2]!
          : 0;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Closest point on segments [lo, hi) to (x, y, z). Updates best*. */
  private testSegments(
    lo: number,
    hi: number,
    x: number,
    y: number,
    z: number,
  ): void {
    const p = this.positions;
    for (let i = lo; i < hi; i++) {
      const t = this.segTick[i]!;
      const a = t * 3;
      const ax = p[a]! - x,
        ay = p[a + 1]! - y,
        az = p[a + 2]! - z;
      const d0 = ax * ax + ay * ay + az * az;
      if (d0 < this.bestDistSq) {
        this.bestDistSq = d0;
        this.bestTick = t;
      }
      const ex = p[a + 3]! - p[a]!,
        ey = p[a + 4]! - p[a + 1]!,
        ez = p[a + 5]! - p[a + 2]!;
      const len = ex * ex + ey * ey + ez * ez;
      if (len === 0) continue;
      const s = -(ax * ex + ay * ey + az * ez) / len;
      if (s <= 0 || s >= 1) continue;
      const cx = ax + ex * s,
        cy = ay + ey * s,
        cz = az + ez * s;
      const ds = cx * cx + cy * cy + cz * cz;
      if (ds < this.bestDistSq) {
        this.bestDistSq = ds;
        this.bestTick = t + s;
      }
    }
    // The final point of the last segment is only reachable as an endpoint of
    // that segment, which the projection above skips at s === 1. Test it here so
    // the very end of the run can be matched.
    if (hi > lo) {
      const t = this.segTick[hi - 1]! + 1;
      const a = t * 3;
      const ax = p[a]! - x,
        ay = p[a + 1]! - y,
        az = p[a + 2]! - z;
      const d = ax * ax + ay * ay + az * az;
      if (d < this.bestDistSq) {
        this.bestDistSq = d;
        this.bestTick = t;
      }
    }
  }

  /** Allocation-free BVH descent. */
  private searchGlobal(x: number, y: number, z: number): void {
    if (this.nodeCount === 0) return;
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp]!;
      if (this.nodeDistSq(node, x, y, z) >= this.bestDistSq) continue;
      const lo = this.nodeLo[node]!;
      if (lo >= 0) {
        this.testSegments(lo, this.nodeHi[node]!, x, y, z);
        continue;
      }
      const left = this.nodeLeft[node]!;
      const right = this.nodeRight[node]!;
      const dl = this.nodeDistSq(left, x, y, z);
      const dr = this.nodeDistSq(right, x, y, z);
      if (sp + 2 > MAX_STACK) continue;
      // Push the far child first so the near child is popped and tested first;
      // a tight best distance then prunes the far one.
      if (dl <= dr) {
        stack[sp++] = right;
        stack[sp++] = left;
      } else {
        stack[sp++] = left;
        stack[sp++] = right;
      }
    }
  }

  /** Binary search for the first segment whose start tick is >= tick. */
  private segmentIndexFor(tick: number): number {
    let lo = 0;
    let hi = this.segTick.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.segTick[mid]! < tick) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private searchWindow(centre: number, x: number, y: number, z: number): void {
    const back = Math.round(WINDOW_BACK_SECONDS * this.tickRate);
    const forward = Math.round(WINDOW_FORWARD_SECONDS * this.tickRate);
    const lo = this.segmentIndexFor(centre - back);
    const hi = Math.min(
      this.segTick.length,
      this.segmentIndexFor(centre + forward) + 1,
    );
    if (hi > lo) this.testSegments(lo, hi, x, y, z);
  }

  /** Forget the temporal lock. Call on seek, teleport or replay change. */
  reset(): void {
    this.lastMatch = -1;
  }

  /**
   * Checks the invariant that makes distance pruning sound: every point a leaf
   * can test lies inside that leaf's bounds, and every node contains its
   * children. Exposed so it can be asserted in tests rather than assumed.
   */
  validateBounds(): { ok: boolean; problems: string[] } {
    const problems: string[] = [];
    const p = this.positions;
    const contains = (node: number, o: number): boolean => {
      const b = node * 3;
      for (let i = 0; i < 3; i++)
        if (
          p[o + i]! < this.nodeMin[b + i]! ||
          p[o + i]! > this.nodeMax[b + i]!
        )
          return false;
      return true;
    };
    for (let node = 0; node < this.nodeCount; node++) {
      const lo = this.nodeLo[node]!;
      if (lo >= 0) {
        const hi = this.nodeHi[node]!;
        for (let i = lo; i < hi; i++) {
          // Both endpoints, including the far end of the last segment.
          for (let e = 0; e < 2; e++)
            if (!contains(node, (this.segTick[i]! + e) * 3))
              problems.push(
                `leaf ${node} does not contain tick ${this.segTick[i]! + e}`,
              );
        }
        continue;
      }
      for (const child of [this.nodeLeft[node]!, this.nodeRight[node]!]) {
        const a = node * 3;
        const c = child * 3;
        for (let i = 0; i < 3; i++)
          if (
            this.nodeMin[c + i]! < this.nodeMin[a + i]! ||
            this.nodeMax[c + i]! > this.nodeMax[a + i]!
          )
            problems.push(
              `node ${node} does not contain child ${child} on axis ${i}`,
            );
      }
    }
    return { ok: problems.length === 0, problems: problems.slice(0, 10) };
  }

  /** Exhaustive nearest-point search, for cross-checking the BVH in tests. */
  bruteForce(pos: Float32Array): { tick: number; distance: number } {
    this.bestDistSq = Infinity;
    this.bestTick = this.startTick;
    this.testSegments(0, this.segTick.length, pos[0]!, pos[1]!, pos[2]!);
    return { tick: this.bestTick, distance: Math.sqrt(this.bestDistSq) };
  }

  /** Global BVH search with no temporal bias, for tests. */
  nearest(pos: Float32Array): { tick: number; distance: number } {
    this.bestDistSq = Infinity;
    this.bestTick = this.startTick;
    this.searchGlobal(pos[0]!, pos[1]!, pos[2]!);
    return { tick: this.bestTick, distance: Math.sqrt(this.bestDistSq) };
  }

  /**
   * `seekGeneration` is bumped by the playback engine on any discontinuous
   * playhead move, which invalidates the temporal lock. `out` is reused.
   */
  sample(
    pos: Float32Array,
    out: DiffSample,
    seekGeneration = this.lastSeekGeneration,
  ): void {
    if (seekGeneration !== this.lastSeekGeneration) {
      this.lastSeekGeneration = seekGeneration;
      this.lastMatch = -1;
    }
    if (this.segTick.length === 0) {
      out.valid = false;
      out.distance = Infinity;
      return;
    }

    const x = pos[0]!,
      y = pos[1]!,
      z = pos[2]!;
    let matched = -1;
    let matchedDistSq = Infinity;

    if (this.lastMatch >= 0) {
      this.bestDistSq = Infinity;
      this.bestTick = this.startTick;
      this.searchWindow(this.lastMatch, x, y, z);
      matched = this.bestTick;
      matchedDistSq = this.bestDistSq;
    }

    // Re-lock globally when there is no lock yet, or when the local window did
    // not produce a convincing match.
    if (
      matched < 0 ||
      matchedDistSq > LOCAL_ACCEPT_DISTANCE * LOCAL_ACCEPT_DISTANCE
    ) {
      const localTick = matched;
      const localDistSq = matchedDistSq;
      this.bestDistSq = Infinity;
      this.bestTick = this.startTick;
      this.searchGlobal(x, y, z);
      // Keep the temporally continuous match unless the global one is clearly
      // better. Distance alone is not proof of correspondence on a route that
      // crosses itself, so continuity wins anything close to a tie.
      if (
        localTick >= 0 &&
        this.bestDistSq > localDistSq * RELOCK_ADVANTAGE * RELOCK_ADVANTAGE
      ) {
        this.bestDistSq = localDistSq;
        this.bestTick = localTick;
      }
      matched = this.bestTick;
      matchedDistSq = this.bestDistSq;
    }

    this.lastMatch = matched;
    const distance = Math.sqrt(matchedDistSq);
    out.distance = distance;
    out.valid = distance <= MAX_MATCH_DISTANCE;
    out.time = (matched - this.startTick) / this.tickRate;
    const t0 = Math.floor(matched);
    const t1 = Math.min(t0 + 1, this.endTick);
    const s0 = this.speeds[t0]!;
    const s1 = this.speeds[t1]!;
    out.speed =
      Number.isNaN(s0) || Number.isNaN(s1)
        ? NaN
        : s0 + (s1 - s0) * (matched - t0);
  }
}

function countNodes(size: number, depth: number): number {
  if (size <= 0) return 0;
  if (size <= LEAF_SIZE || depth >= MAX_STACK - 2) return 1;
  const mid = size >> 1;
  return 1 + countNodes(mid, depth + 1) + countNodes(size - mid, depth + 1);
}

export function createDiffSample(): DiffSample {
  return { time: 0, speed: 0, distance: Infinity, valid: false };
}
