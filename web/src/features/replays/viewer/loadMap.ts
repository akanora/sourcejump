// Downloads and parses a map alongside its stock indexes, preserving Source's asset search priority.
import ArrayBufferSlice from "./noclip/ArrayBufferSlice";
import type { DataFetcher } from "./noclip/DataFetcher";
import { BSPFile, BSPFileVariant } from "./noclip/SourceEngine/BSPFile";
import { SourceFileSystem } from "./noclip/SourceEngine/Main";
import { measureMapLoad } from "./loadTiming";

/** The order matters even when the requests finish in a different order. */
const STOCK_VPKS = ["cstrike_pak", "hl2_textures", "hl2_misc"];

export async function loadMap(
  mapUrl: string,
  mapName: string,
  stockContentUrl: string,
  dataFetcher: DataFetcher,
  signal: AbortSignal,
): Promise<{ bsp: BSPFile; filesystem: SourceFileSystem }> {
  signal.throwIfAborted();
  const filesystem = new SourceFileSystem(dataFetcher);
  const abort = () => dataFetcher.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const map = measureMapLoad("map-download", mapName, async () => {
      const response = await fetch(mapUrl, { signal });
      if (!response.ok)
        throw new Error(`The map didn't load (${response.status}).`);
      return response.arrayBuffer();
    }).then((bytes) => {
      signal.throwIfAborted();
      return measureMapLoad("bsp-parse", mapName, () => {
        // Wrap the download: copying it would hold a large map in memory twice.
        const bsp = new BSPFile(
          new ArrayBufferSlice(bytes),
          mapName,
          BSPFileVariant.Default,
        );
        if (bsp.pakfile !== null) filesystem.addPakFile(bsp.pakfile);
        return bsp;
      });
    });
    const stock = measureMapLoad("stock-indexes", mapName, () =>
      Promise.all(
        STOCK_VPKS.map(async (name) => {
          try {
            // createVPKMount reserves its search slot before awaiting the download.
            await filesystem.createVPKMount(`${stockContentUrl}/${name}`);
          } catch (error) {
            if (!signal.aborted && !dataFetcher.aborted)
              console.warn(`[replay] stock archive ${name} didn't load`, error);
          }
        }),
      ),
    );
    const [bsp] = await Promise.all([map, stock]);
    signal.throwIfAborted();
    // Failed mounts leave reserved slots empty; later lookups must skip those slots.
    filesystem.vpk = filesystem.vpk.filter((mount) => mount != null);
    return { bsp, filesystem };
  } catch (error) {
    dataFetcher.abort();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
