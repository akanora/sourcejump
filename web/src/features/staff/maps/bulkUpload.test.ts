import { describe, expect, it } from "vitest";
import { MAX_PACKED_BYTES, sortFiles } from "./bulkUpload";

const file = (name: string) => new File([], name);

/** A file that says it's `size` bytes, without holding them. */
function sized(name: string, size: number): File {
  const made = file(name);
  Object.defineProperty(made, "size", { value: size });
  return made;
}

describe("sortFiles", () => {
  it("keeps one file per map, preferring packed, then .bsp over .bsp.bz2", () => {
    const { maps, refused } = sortFiles([
      file("bhop_a.bsp"),
      file("bhop_a.viewer.br"),
      file("BHOP_B.bsp.bz2"),
      file("bhop_b.bsp"),
      file("bhop_c.bsp.bz2"),
      file("notes.txt"),
      file("sj-pack"),
    ]);
    expect(
      maps.map(({ map, file, packed }) => [map, file.name, packed]),
    ).toEqual([
      ["bhop_a", "bhop_a.viewer.br", true],
      ["bhop_b", "bhop_b.bsp", false],
      ["bhop_c", "bhop_c.bsp.bz2", false],
    ]);
    expect(refused).toEqual([]);
  });

  it("refuses names SourceJump doesn't accept and files over the limits", () => {
    const { maps, refused } = sortFiles([
      file("bhop eazy.bsp"),
      sized("bhop_big.viewer.br", MAX_PACKED_BYTES + 1),
    ]);
    expect(maps).toEqual([]);
    expect(refused.map((r) => r.file)).toEqual([
      "bhop eazy.bsp",
      "bhop_big.viewer.br",
    ]);
  });
});
