// Optional real-map benchmark: SJ_PACKED_MAPS points at locally packed maps; copyrighted assets stay outside git.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { expect, it } from "vitest";
import ArrayBufferSlice from "./noclip/ArrayBufferSlice";
import { BSPFile } from "./noclip/SourceEngine/BSPFile";

const folder = process.env.SJ_PACKED_MAPS;

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Includes parsed geometry, lighting, entities and collision, but not the potentially huge embedded pakfile. */
function fingerprint(bsp: BSPFile): string {
  return hash(
    Buffer.from(
      JSON.stringify(bsp, (key, value) => {
        if (key === "pakfile") return undefined;
        if (value instanceof ArrayBuffer)
          return { bytes: value.byteLength, hash: hash(new Uint8Array(value)) };
        if (ArrayBuffer.isView(value))
          return {
            bytes: value.byteLength,
            hash: hash(
              new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
            ),
          };
        return value;
      }),
    ),
  );
}

it.skipIf(!folder)(
  "reads real packed maps with unchanged rendering and collision data",
  () => {
    const previous = process.env.SJ_MAP_BENCH_BASELINE
      ? (JSON.parse(
          readFileSync(process.env.SJ_MAP_BENCH_BASELINE, "utf8"),
        ) as { map: string; fingerprint: string }[])
      : [];
    const results = [];
    for (const name of readdirSync(folder!)
      .filter((name) => name.endsWith(".bsp"))
      .sort()) {
      const packed = readFileSync(join(folder!, name));
      const start = performance.now();
      const bytes = brotliDecompressSync(packed);
      const decoded = performance.now();
      const bsp = new BSPFile(ArrayBufferSlice.fromView(bytes), name);
      const parsed = performance.now();
      const result = {
        map: name,
        packedBytes: packed.byteLength,
        decodedBytes: bytes.byteLength,
        decodeMs: decoded - start,
        parseMs: parsed - decoded,
        geometryBytes: bsp.vertexData.byteLength + bsp.indexData.byteLength,
        fingerprint: fingerprint(bsp),
      };
      const baseline = previous.find((row) => row.map === name);
      if (process.env.SJ_MAP_BENCH_BASELINE) {
        expect(baseline, name).toBeDefined();
        expect(result.fingerprint, name).toBe(baseline!.fingerprint);
      }
      expect(bsp.models.length, name).toBeGreaterThan(0);
      results.push(result);
    }
    expect(results.length).toBeGreaterThan(0);
    if (process.env.SJ_MAP_BENCH_OUTPUT)
      writeFileSync(
        process.env.SJ_MAP_BENCH_OUTPUT,
        JSON.stringify(results, null, 2),
      );
  },
  180_000,
);
