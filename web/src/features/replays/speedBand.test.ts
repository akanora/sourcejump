// The HUD's speed colour: decided per 10-tick sample, as the in-game speedometer does.
import { describe, expect, it } from "vitest";
import { speedBand } from "./speedBand";
import type { PlaybackState } from "./viewer/playback";

const at = (tick: number, speed: number) => ({ tick, speed }) as PlaybackState;

describe("speedBand", () => {
  it("compares each sample with the one before", () => {
    const sample = { tick: 0, speed: 300 };
    expect(speedBand(sample, at(10, 320))).toBe("gaining");
    expect(speedBand(sample, at(20, 310))).toBe("losing");
    expect(speedBand(sample, at(30, 310.6))).toBe("holding");
  });

  it("keeps its colour between samples", () => {
    const sample = { tick: 0, speed: 300 };
    expect(speedBand(sample, at(9, 500))).toBeNull();
    expect(sample).toEqual({ tick: 0, speed: 300 });
  });

  it("reports no change across a seek or the first frame", () => {
    expect(speedBand({ tick: 100, speed: 300 }, at(50, 900))).toBe("holding");
    expect(speedBand({ tick: 0, speed: 300 }, at(500, 900))).toBe("holding");
    expect(speedBand({ tick: Number.NaN, speed: 0 }, at(0, 260))).toBe(
      "holding",
    );
  });

  it("holds the last speed across a teleport", () => {
    const sample = { tick: 0, speed: 300 };
    expect(speedBand(sample, at(10, Number.NaN))).toBe("holding");
    expect(sample.speed).toBe(300);
  });
});
