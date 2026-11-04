// Independent downloads must overlap without changing map overrides or stock archive precedence.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArrayBufferSlice from "./noclip/ArrayBufferSlice";
import { DataFetcher } from "./noclip/DataFetcher";
import { createVPKMount, type VPKMount } from "./noclip/SourceEngine/VPK";
import { loadMap } from "./loadMap";

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("./noclip/SourceEngine/BSPFile", async (original) => ({
  ...(await original<typeof import("./noclip/SourceEngine/BSPFile")>()),
  BSPFile: class {
    pakfile = parse();
  },
}));
vi.mock("./noclip/SourceEngine/VPK", () => ({ createVPKMount: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const url = "https://maps.test/map.bsp";
const stockUrl = "https://maps.test/stock";
const response = () => new Response(new Uint8Array(4));
const mounts = () => [
  deferred<VPKMount>(),
  deferred<VPKMount>(),
  deferred<VPKMount>(),
];

/** Each stock archive contains the same virtual file, but with a distinct value. */
function mount(value: number): VPKMount {
  return {
    findEntry: () => ({}),
    fetchFileData: async () =>
      new ArrayBufferSlice(Uint8Array.of(value).buffer),
  } as unknown as VPKMount;
}

beforeEach(() => {
  parse.mockReset().mockReturnValue(null);
  vi.mocked(createVPKMount).mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  performance.clearMeasures();
});

describe("loadMap", () => {
  it("starts all downloads together and retains stock priority when they finish backwards", async () => {
    const download = deferred<Response>();
    const fetch = vi.fn(() => download.promise);
    vi.stubGlobal("fetch", fetch);
    const pending = mounts();
    let next = 0;
    vi.mocked(createVPKMount).mockImplementation(
      () => pending[next++]!.promise,
    );
    const fetcher = new DataFetcher();
    const result = loadMap(
      url,
      "map",
      stockUrl,
      fetcher,
      new AbortController().signal,
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(createVPKMount).mock.calls.map((call) => call[1])).toEqual(
      [
        `${stockUrl}/cstrike_pak`,
        `${stockUrl}/hl2_textures`,
        `${stockUrl}/hl2_misc`,
      ],
    );
    // Parsing can proceed while every index is still in flight.
    download.resolve(response());
    await vi.waitFor(() => expect(parse).toHaveBeenCalledOnce());
    const archives = [mount(1), mount(2), mount(3)];
    for (const i of [2, 1, 0]) pending[i]!.resolve(archives[i]!);
    const { filesystem } = await result;
    expect(filesystem.vpk).toEqual(archives);
    const file = await filesystem.fetchFileData("materials/shared.vmt");
    expect([...file!.createTypedArray(Uint8Array)]).toEqual([1]);
  });

  it("keeps map overrides ahead of stock and removes a failed mount's reserved slot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
    parse.mockReturnValue([
      {
        filename: "materials/shared.vmt",
        data: new ArrayBufferSlice(Uint8Array.of(9).buffer),
        compressionMethod: 0,
      },
    ]);
    const first = mount(1),
      last = mount(3);
    vi.mocked(createVPKMount)
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("missing archive"))
      .mockResolvedValueOnce(last);
    const { filesystem } = await loadMap(
      url,
      "map",
      stockUrl,
      new DataFetcher(),
      new AbortController().signal,
    );
    expect(filesystem.vpk).toEqual([first, last]);
    const file = await filesystem.fetchFileData("materials/shared.vmt");
    expect([...file!.createTypedArray(Uint8Array)]).toEqual([9]);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("cancels outstanding stock work when the map download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const pending = mounts();
    let next = 0;
    vi.mocked(createVPKMount).mockImplementation(
      () => pending[next++]!.promise,
    );
    const fetcher = new DataFetcher();
    const abort = vi.spyOn(fetcher, "abort");
    await expect(
      loadMap(url, "map", stockUrl, fetcher, new AbortController().signal),
    ).rejects.toThrow("404");
    expect(abort).toHaveBeenCalledOnce();
    expect(parse).not.toHaveBeenCalled();
    for (const p of pending) p.reject(new Error("cancelled"));
    await Promise.allSettled(pending.map((p) => p.promise));
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("aborts stock requests and refuses the map when cancelled during loading", async () => {
    const signal = new AbortController();
    const fetcher = new DataFetcher();
    const pending = mounts();
    let next = 0;
    vi.mocked(createVPKMount).mockImplementation(
      () => pending[next++]!.promise,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
    const result = loadMap(url, "map", stockUrl, fetcher, signal.signal);
    const rejected = expect(result).rejects.toThrow("closed");
    signal.abort(new Error("closed"));
    expect(fetcher.aborted).toBe(true);
    for (const p of pending) p.reject(new Error("cancelled"));
    await rejected;
    expect(parse).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does not issue any requests for an already cancelled load", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      loadMap(url, "map", stockUrl, new DataFetcher(), AbortSignal.abort()),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(createVPKMount).not.toHaveBeenCalled();
  });
});
