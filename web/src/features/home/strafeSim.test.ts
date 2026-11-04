import { describe, expect, it } from "vitest";
import { simulateStrafes, tickSeconds } from "./strafeSim";

describe("simulateStrafes", () => {
  const ticks = simulateStrafes(10);

  it("gains speed from strafing alone", () => {
    expect(ticks[0]!.speed).toBeGreaterThanOrEqual(250);
    expect(ticks.at(-1)!.speed).toBeGreaterThan(600);
    // Only switching strafes costs speed, a little, on the tick the keys change; every other tick gains.
    for (let i = 1; i < ticks.length; i++) {
      const change = ticks[i]!.speed - ticks[i - 1]!.speed;
      if (ticks[i]!.jump) expect(change).toBeGreaterThan(-1);
      else expect(change).toBeGreaterThan(0);
    }
  });

  it("jumps on landing, once per Source jump arc", () => {
    const jumps = ticks.flatMap((tick, index) => (tick.jump ? [index] : []));
    // A jump at 57 units of height lasts about 0.755 s under 800 gravity.
    const gaps = jumps.slice(1).map((jump, i) => jump - jumps[i]!);
    for (const gap of gaps) {
      expect(gap * tickSeconds).toBeCloseTo(0.755, 1);
    }
    for (const index of jumps.slice(1)) {
      expect(ticks[index - 1]!.z).toBeLessThan(5);
    }
  });

  it("switches strafe key with each hop and weaves around the line forward", () => {
    const keys = ticks.filter((tick) => tick.jump).map((tick) => tick.key);
    keys.slice(1).forEach((key, i) => expect(key).not.toBe(keys[i]));
    const ys = ticks.map((tick) => tick.y);
    expect(Math.min(...ys)).toBeLessThan(-30);
    expect(Math.max(...ys)).toBeGreaterThan(30);
  });
});
