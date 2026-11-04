// Interpolation between replay ticks (from daf's replay viewer, math.ts).
export function deltaAngle(a: number, b: number): number {
  return b - a - Math.floor((b - a + 180) / 360) * 360;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Catmull-Rom with the tangents clamped so the curve can never leave the
// [p1, p2] interval by more than `slack` times the segment length. Unclamped
// cubic overshoot on a sharp bhop turn visibly throws the camera off the
// recorded route; clamping keeps the extra smoothness without inventing
// positions the player never occupied.
export function hermiteValueClamped(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
  slack: number,
): number {
  const seg = p2 - p1;
  const limit = Math.abs(seg) * slack;
  let m0 = (p2 - p0) * 0.5;
  let m1 = (p3 - p1) * 0.5;
  // Tangents pointing against the segment direction are what produce the
  // characteristic overshoot lobe, so drop them entirely.
  if (m0 * seg < 0) m0 = 0;
  if (m1 * seg < 0) m1 = 0;
  const hi = Math.abs(seg) + limit;
  if (Math.abs(m0) > hi) m0 = Math.sign(m0) * hi;
  if (Math.abs(m1) > hi) m1 = Math.sign(m1) * hi;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p1 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * p2 +
    (t3 - t2) * m1
  );
}

// Catmull-Rom with one tangent per tick, limited from both sides of it (Fritsch-Carlson), so
// the curve never leaves [p1, p2] and the segments meeting at a tick agree on its slope. Used
// for the view angles: hermiteValueClamped limits each segment on its own, which gives a tick
// two slopes and shows as a jolt in the turn rate. Positions keep that one, since a takeoff or
// a landing really is a kink in vertical speed.
export function hermiteValueMonotone(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const m0 = knotTangent(p1 - p0, p2 - p1);
  const m1 = knotTangent(p2 - p1, p3 - p2);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p1 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * p2 +
    (t3 - t2) * m1
  );
}

// Flat where the motion reverses; otherwise capped at three times the shorter neighbouring
// step, which is what keeps each segment monotonic.
function knotTangent(before: number, after: number): number {
  if (before * after <= 0) return 0;
  const m = (before + after) * 0.5;
  const limit = 3 * Math.min(Math.abs(before), Math.abs(after));
  return Math.abs(m) > limit ? Math.sign(m) * limit : m;
}
