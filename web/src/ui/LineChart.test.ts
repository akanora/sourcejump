// The chart's axis top: a round number at or above the data, so the gridlines land on readable values.
import { describe, expect, it } from "vitest";
import { niceMax } from "./LineChart";

describe("niceMax", () => {
  it("rounds up to a round number close above the data", () => {
    expect([0, 1, 3, 7, 24, 47, 51, 180, 999].map(niceMax)).toEqual([
      1, 1, 3, 8, 30, 50, 60, 200, 1000,
    ]);
  });
});
