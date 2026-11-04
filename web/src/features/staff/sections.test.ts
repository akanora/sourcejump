import { describe, expect, it } from "vitest";
import { isCurrentSection, isStaff, sectionsFor } from "./sections";

describe("staff sections", () => {
  it("treats posting alone as not staff", () => {
    expect(isStaff([])).toBe(false);
    expect(isStaff(["post_community"])).toBe(false);
    expect(isStaff(["post_community", "manage_maps"])).toBe(true);
  });

  it("shows no sections to players who aren't staff", () => {
    expect(sectionsFor(["post_community"])).toEqual([]);
    expect(sectionsFor(["manage_maps"]).map((s) => s.href)).toContain("/staff");
  });

  it("shows a section only to holders of its privilege", () => {
    const hrefs = (privileges: Parameters<typeof sectionsFor>[0]) =>
      sectionsFor(privileges).map((s) => s.href);
    expect(hrefs(["manage_maps"])).not.toContain("/staff/keys");
    expect(hrefs(["manage_keys"])).toContain("/staff/keys");
    // Players, runs and maps are managed on their own pages, so these privileges open only the log.
    expect(hrefs(["invalidate_runs"])).toEqual(["/staff"]);
    expect(hrefs(["manage_bans", "manage_privileges"])).toEqual(["/staff"]);
    expect(hrefs(["manage_maps", "manage_zones"])).toEqual(["/staff"]);
  });

  it("marks the logs only on their own page", () => {
    expect(isCurrentSection("/staff", "/staff")).toBe(true);
    expect(isCurrentSection("/staff", "/staff/keys")).toBe(false);
    expect(isCurrentSection("/staff/keys", "/staff/keys")).toBe(true);
    expect(isCurrentSection("/staff/keys", "/staff/keys/new")).toBe(true);
    expect(isCurrentSection("/staff/keys", "/staff/keysx")).toBe(false);
  });
});
