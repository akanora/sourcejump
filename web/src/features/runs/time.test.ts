// Run times are written the same way everywhere, to the millisecond.
import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatAge,
  formatAgo,
  formatDateTime,
  formatGap,
  formatSince,
  formatTime,
  trackName,
} from "./time";

describe("formatTime", () => {
  it("writes seconds, minutes and hours", () => {
    expect(formatTime(24.405)).toBe("24.405");
    expect(formatTime(84.405)).toBe("1:24.405");
    expect(formatTime(3723.004)).toBe("1:02:03.004");
    expect(formatTime(0.5)).toBe("0.500");
  });

  it("rounds to the millisecond without showing 60 seconds", () => {
    expect(formatTime(59.9996)).toBe("1:00.000");
    expect(formatTime(60.0004)).toBe("1:00.000");
  });
});

describe("formatDate", () => {
  it("uses UTC", () => {
    expect(formatDate("2026-10-19T23:30:00Z")).toBe("Oct 19, 2026");
  });
});

describe("formatGap", () => {
  it("writes the gap with a plus sign, at the same precision as times", () => {
    expect(formatGap(0.605)).toBe("+0.605");
    expect(formatGap(62.33)).toBe("+1:02.330");
    expect(formatGap(0)).toBe("+0.000");
  });
});

describe("trackName", () => {
  it("names the main track and bonuses", () => {
    expect(trackName(0)).toBe("Main");
    expect(trackName(2)).toBe("Bonus 2");
  });
});

describe("formatDateTime", () => {
  it("writes log times in UTC to the minute", () => {
    expect(formatDateTime("2026-10-19T14:03:59Z")).toBe(
      "Oct 19, 2026, 14:03 UTC",
    );
  });
});

describe("formatAgo", () => {
  it("picks minutes, hours or days", () => {
    expect(formatAgo(0)).toBe("this minute");
    expect(formatAgo(12)).toBe("12 minutes ago");
    expect(formatAgo(90)).toBe("2 hours ago");
    expect(formatAgo(47 * 60)).toBe("47 hours ago");
    expect(formatAgo(3 * 24 * 60)).toBe("3 days ago");
  });
});

describe("formatSince", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const ago = (minutes: number) =>
    formatSince(new Date(now.getTime() - minutes * 60_000).toISOString(), now);

  it("counts minutes, hours and days, then gives the date", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(12)).toBe("12 min ago");
    expect(ago(5 * 60 + 59)).toBe("5 h ago");
    expect(ago(30 * 60)).toBe("Yesterday");
    expect(ago(3 * 24 * 60)).toBe("3 days ago");
    expect(ago(9 * 24 * 60)).toBe("Oct 12");
  });

  it("adds the year to dates from another year", () => {
    expect(formatSince("2025-12-30T08:00:00Z", now)).toBe("Dec 30, 2025");
  });
});

describe("formatAge", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("uses the largest whole unit", () => {
    expect(formatAge("2026-10-27T11:59:30Z", now)).toBe("just now");
    expect(formatAge("2026-10-27T11:48:00Z", now)).toBe("12m ago");
    expect(formatAge("2026-10-27T07:00:00Z", now)).toBe("5h ago");
    expect(formatAge("2026-10-24T09:00:00Z", now)).toBe("3d ago");
    expect(formatAge("2026-06-01T12:00:00Z", now)).toBe("4mo ago");
    expect(formatAge("2024-10-01T12:00:00Z", now)).toBe("2y ago");
  });
});
