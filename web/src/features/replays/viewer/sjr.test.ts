// The viewer reads an SJR file back to exactly the frames of the shavit file the API stored it from.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadReplay } from "./sjr";

// bhop_maze.sjr is what the API's replay job stored for the shavit file below (api/.../replays/sjr.rs).
const sjr = readFileSync(new URL("./fixtures/bhop_maze.sjr", import.meta.url));
const shavit = readFileSync(
  new URL(
    "../../../../../api/crates/api/src/replays/fixtures/bhop_maze.replay",
    import.meta.url,
  ),
);
// Format 12's header for this file: first line, "bhop_maze\0", then 2 + 6 × 4 + 12 bytes of fields.
const HEADER_LENGTH =
  "12:{SHAVITREPLAYFORMAT}{FINAL}\n".length + "bhop_maze".length + 1 + 38;
const FRAME_BYTES = 40;

afterEach(() => vi.unstubAllGlobals());

describe("loadReplay", () => {
  it("decodes every frame and the header fields playback uses", async () => {
    vi.stubGlobal("fetch", async () => new Response(sjr));
    const replay = await loadReplay(
      "bhop_maze.sjr",
      new AbortController().signal,
    );

    expect(replay).toMatchObject({
      tickRate: 100,
      preFrames: 119,
      postFrames: 77,
    });
    expect(replay.time).toBeCloseTo(10.0914, 4);
    expect(replay.tickCount).toBe(
      (shavit.length - HEADER_LENGTH) / FRAME_BYTES,
    );

    const frames = new DataView(
      shavit.buffer,
      shavit.byteOffset + HEADER_LENGTH,
    );
    for (let tick = 0; tick < replay.tickCount; tick++) {
      const at = tick * FRAME_BYTES;
      for (let axis = 0; axis < 3; axis++)
        expect(replay.positions[tick * 3 + axis]).toBe(
          frames.getFloat32(at + axis * 4, true),
        );
      expect(replay.angles[tick * 2]).toBe(frames.getFloat32(at + 12, true));
      expect(replay.angles[tick * 2 + 1]).toBe(
        frames.getFloat32(at + 16, true),
      );
      expect(replay.buttons[tick]).toBe(frames.getInt32(at + 20, true));
      expect(replay.flags[tick]).toBe(frames.getInt32(at + 24, true));
    }
  });

  it("refuses a file that isn't SJR", async () => {
    vi.stubGlobal("fetch", async () => new Response(shavit));
    await expect(loadReplay("x", new AbortController().signal)).rejects.toThrow(
      "isn't one this viewer reads",
    );
  });
});
