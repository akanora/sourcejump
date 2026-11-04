// Reading the run to compare with from what a viewer types or pastes.
import { describe, expect, it } from "vitest";
import { parseRunId } from "./runId";

describe("parseRunId", () => {
  it("takes a number, with or without #, or a run page's link", () => {
    expect(parseRunId("1651")).toBe(1651);
    expect(parseRunId(" #1651 ")).toBe(1651);
    expect(parseRunId("https://sourcejump.net/runs/1651#replay")).toBe(1651);
    expect(parseRunId("/runs/1651?x=1")).toBe(1651);
  });

  it("refuses anything else", () => {
    expect(parseRunId("")).toBeNull();
    expect(parseRunId("bhop_bfur")).toBeNull();
    expect(parseRunId("https://sourcejump.net/maps/bhop_1651")).toBeNull();
    expect(parseRunId("0")).toBeNull();
  });
});
