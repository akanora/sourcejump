// The header marks a section current on its own page and the pages below it, and nowhere else.
import { describe, expect, it } from "vitest";
import { isCurrent } from "./navigation";

describe("isCurrent", () => {
  it("matches Home only on the home page", () => {
    expect(isCurrent("/", "/")).toBe(true);
    expect(isCurrent("/", "/maps")).toBe(false);
  });

  it("matches a section and its subpages", () => {
    expect(isCurrent("/maps", "/maps")).toBe(true);
    expect(isCurrent("/maps", "/maps/bhop_forest")).toBe(true);
  });

  it("doesn't match a section that only shares a prefix", () => {
    expect(isCurrent("/players", "/playersearch")).toBe(false);
  });
});
