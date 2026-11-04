// A release date says as much as staff know, and no more.
import { describe, expect, it } from "vitest";
import { formatReleaseDate, releaseDateTime } from "./releaseDate";

describe("release dates", () => {
  it("say only as much as staff know", () => {
    expect(formatReleaseDate({ year: 2015 })).toBe("2015");
    expect(formatReleaseDate({ year: 2015, month: 6 })).toBe("Jun 2015");
    expect(formatReleaseDate({ year: 2015, month: 6, day: 4 })).toBe(
      "Jun 4, 2015",
    );
  });

  it("give <time> a year, a month or a day", () => {
    expect(releaseDateTime({ year: 2015, month: null, day: null })).toBe(
      "2015",
    );
    expect(releaseDateTime({ year: 2015, month: 6 })).toBe("2015-06");
    expect(releaseDateTime({ year: 2015, month: 6, day: 4 })).toBe(
      "2015-06-04",
    );
  });
});
