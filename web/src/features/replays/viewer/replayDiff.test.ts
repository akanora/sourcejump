// Route matching for the comparison deltas (from daf's replay viewer's tests).
import { describe, expect, it } from "vitest";
import { FL_ONGROUND, MovementAnalysis, type RunTicks } from "./movement";
import { createDiffSample, ReplayDiff } from "./replayDiff";

type Tick = { pos: [number, number, number] };

/** A straight run along +X at a constant per-tick step. */
function straightRun(count: number, step = 10): Tick[] {
  return Array.from({ length: count }, (_, i) => ({ pos: [i * step, 0, 0] }));
}

function diffFor(ticks: Tick[], runTicks?: RunTicks, tickRate = 100) {
  const n = ticks.length;
  const positions = Float32Array.from(ticks.flatMap((tick) => tick.pos));
  const flags = new Int32Array(n).fill(FL_ONGROUND);
  const analysis = new MovementAnalysis(
    positions,
    flags,
    new Int32Array(n),
    n,
    tickRate,
  );
  return new ReplayDiff(
    positions,
    tickRate,
    runTicks ?? { start: 0, end: n - 1 },
    analysis,
  );
}

const at = (x: number, y = 0, z = 0) => Float32Array.from([x, y, z]);

describe("BVH structure", () => {
  it("keeps every tested point inside its leaf bounds", () => {
    for (const count of [2, 3, 17, 33, 64, 65, 500]) {
      const diff = diffFor(straightRun(count, 9));
      const result = diff.validateBounds();
      expect(result.problems).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it("keeps bounds valid on a route with teleport splits", () => {
    const ticks = straightRun(200, 9);
    for (const cut of [40, 41, 120])
      for (let i = cut; i < 200; i++) ticks[i]!.pos[1] += 4000;
    const diff = diffFor(ticks);
    expect(diff.validateBounds().problems).toEqual([]);
  });

  it("survives degenerate inputs", () => {
    expect(() => diffFor(straightRun(1, 5))).not.toThrow();
    const empty = diffFor(straightRun(1, 5));
    const out = createDiffSample();
    empty.sample(at(0), out);
    expect(out.valid).toBe(false);
  });

  it("agrees with an exhaustive search", () => {
    const diff = diffFor(straightRun(300, 7));
    for (const probe of [
      at(3.5),
      at(500, 20),
      at(2093, -5, 3),
      at(-40),
      at(9999),
    ]) {
      const bvh = diff.nearest(probe);
      const brute = diff.bruteForce(probe);
      expect(bvh.distance).toBeCloseTo(brute.distance, 3);
    }
  });

  it("can match the very last point of the run", () => {
    const diff = diffFor(straightRun(100, 10));
    const last = diff.nearest(at(990, 0, 0));
    expect(last.tick).toBeCloseTo(99, 3);
    expect(last.distance).toBeCloseTo(0, 3);
  });
});

describe("matching", () => {
  it("reports zero difference against an identical route", () => {
    const ticks = straightRun(300, 8);
    const diff = diffFor(ticks);
    const out = createDiffSample();
    for (let t = 0; t < 300; t += 17) {
      diff.sample(at(t * 8), out);
      expect(out.valid).toBe(true);
      expect(out.time).toBeCloseTo(t / 100, 3);
    }
  });

  it("tolerates a small lateral offset", () => {
    const diff = diffFor(straightRun(300, 8));
    const out = createDiffSample();
    diff.sample(at(800, 24), out);
    expect(out.valid).toBe(true);
    expect(out.distance).toBeCloseTo(24, 2);
    expect(out.time).toBeCloseTo(1.0, 2);
  });

  it("marks a far-off-route position as not comparable", () => {
    const diff = diffFor(straightRun(300, 8));
    const out = createDiffSample();
    diff.sample(at(800, 5000), out);
    expect(out.valid).toBe(false);
  });

  it("interpolates comparison speed between ticks", () => {
    const ticks = Array.from({ length: 60 }, (_, i): Tick => ({
      pos: [i * (i < 30 ? 5 : 15), 0, 0],
    }));
    const diff = diffFor(ticks);
    const out = createDiffSample();
    diff.sample(at(ticks[10]!.pos[0]), out);
    expect(out.speed).toBeCloseTo(500, 0);
  });
});

describe("temporal coherence", () => {
  /**
   * A figure-eight style route that returns close to an earlier section. Pure
   * spatial matching jumps to the wrong pass; the temporal lock must not.
   */
  function crossingRoute() {
    const ticks: Tick[] = [];
    for (let i = 0; i < 100; i++) ticks.push({ pos: [i * 10, 0, 0] }); // pass 1 east
    for (let i = 0; i < 100; i++) ticks.push({ pos: [990 - i * 10, 60, 0] }); // return west
    for (let i = 0; i < 100; i++) ticks.push({ pos: [i * 10, 4, 0] }); // pass 2, 4 units from pass 1
    return ticks;
  }

  it("follows the run in order instead of snapping to the nearest pass", () => {
    const diff = diffFor(crossingRoute());
    const out = createDiffSample();
    // Walk pass 1. Every point is within 4 units of the much later pass 3.
    for (let i = 0; i < 100; i += 5) {
      diff.sample(at(i * 10, 0), out);
      expect(out.valid).toBe(true);
      expect(out.time).toBeCloseTo(i / 100, 2);
    }
  });

  it("re-locks after a seek to a different part of the route", () => {
    const diff = diffFor(crossingRoute());
    const out = createDiffSample();
    for (let i = 0; i < 100; i += 5) diff.sample(at(i * 10, 0), out, 1);
    // Same seek generation would keep the old lock; a new one must re-search.
    diff.sample(at(500, 60), out, 2);
    expect(out.valid).toBe(true);
    expect(out.time).toBeCloseTo(1.49, 1);
  });

  it("handles a large backwards seek", () => {
    const diff = diffFor(straightRun(600, 8));
    const out = createDiffSample();
    diff.sample(at(4000), out, 1);
    expect(out.time).toBeCloseTo(5.0, 2);
    diff.sample(at(80), out, 2);
    expect(out.time).toBeCloseTo(0.1, 2);
  });

  it("handles a large forward seek", () => {
    const diff = diffFor(straightRun(600, 8));
    const out = createDiffSample();
    diff.sample(at(80), out, 1);
    diff.sample(at(4720), out, 2);
    expect(out.time).toBeCloseTo(5.9, 2);
  });

  it("distinguishes routes stacked vertically", () => {
    const ticks: Tick[] = [];
    for (let i = 0; i < 120; i++) ticks.push({ pos: [i * 10, 0, 0] }); // ground floor
    for (let i = 0; i < 120; i++) ticks.push({ pos: [1190 - i * 10, 0, 40] }); // upper floor, 40 units above
    const diff = diffFor(ticks);
    const out = createDiffSample();
    for (let i = 0; i < 120; i += 10) {
      diff.sample(at(i * 10, 0, 0), out);
      expect(out.time).toBeCloseTo(i / 100, 2);
    }
  });

  it("never matches inside a teleport gap", () => {
    const ticks = straightRun(200, 9);
    for (let i = 100; i < 200; i++) ticks[i]!.pos[0] += 9000;
    const diff = diffFor(ticks);
    const out = createDiffSample();
    // Midway between the two halves: no recorded segment goes through here.
    diff.sample(at(5000, 0, 0), out);
    expect(out.valid).toBe(false);
  });
});
