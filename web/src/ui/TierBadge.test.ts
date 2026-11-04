// Tier colors follow the tier's position on the ramp, whatever the tier count.
import { describe, expect, it } from "vitest";
import { tierColor } from "./TierBadge";

describe("tierColor", () => {
  it("puts the easiest and hardest tier on the end stops", () => {
    expect(tierColor(1, 10)).toBe("var(--color-tier-1)");
    expect(tierColor(10, 10)).toBe("var(--color-tier-4)");
  });

  it("lands on a middle stop when the position matches it", () => {
    expect(tierColor(4, 10)).toBe("var(--color-tier-2)");
    expect(tierColor(7, 10)).toBe("var(--color-tier-3)");
  });

  it("mixes neighbouring stops between them", () => {
    expect(tierColor(2, 10)).toBe(
      "color-mix(in oklch, var(--color-tier-2) 33%, var(--color-tier-1))",
    );
  });

  it("handles a single tier and out-of-range tiers", () => {
    expect(tierColor(1, 1)).toBe("var(--color-tier-1)");
    expect(tierColor(12, 10)).toBe("var(--color-tier-4)");
  });
});
