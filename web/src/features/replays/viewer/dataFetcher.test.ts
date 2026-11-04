// Asset downloads retain exact bytes without cloning response bodies, and cancellation settles the queue.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataFetcher } from "./noclip/DataFetcher";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function body(chunks: Uint8Array[], status = 200): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { status },
  );
}

describe("asset downloads", () => {
  it("retains a readable body when the optional Cache API store is enabled", async () => {
    const stored: number[][] = [];
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async (_request: Request, response: Response) => {
        stored.push([...new Uint8Array(await response.arrayBuffer())]);
      }),
    };
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => body([Uint8Array.of(1), Uint8Array.of(2)])),
    );
    const fetcher = new DataFetcher();
    await fetcher.init();
    const bytes = await fetcher.fetchURL("https://maps.test/texture");
    expect([...bytes.createTypedArray(Uint8Array)]).toEqual([1, 2]);
    await vi.waitFor(() => expect(stored).toEqual([[1, 2]]));
  });

  it("retries a broken response body instead of returning a partial asset", async () => {
    let reads = 0;
    const broken = new Response(
      new ReadableStream({
        pull(controller) {
          if (reads++ === 0) controller.enqueue(Uint8Array.of(9));
          else controller.error(new Error("connection lost"));
        },
      }),
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(body([Uint8Array.of(1, 2)]));
    vi.stubGlobal("fetch", fetch);
    const result = await new DataFetcher().fetchURL(
      "https://maps.test/texture",
    );
    expect([...result.createTypedArray(Uint8Array)]).toEqual([1, 2]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("assembles multiple chunks without cloning the response", async () => {
    const response = body([Uint8Array.of(1, 2), Uint8Array.of(3, 4)]);
    const clone = vi.spyOn(response, "clone");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const bytes = await new DataFetcher().fetchURL("https://maps.test/texture");
    expect([...bytes.createTypedArray(Uint8Array)]).toEqual([1, 2, 3, 4]);
    expect(clone).not.toHaveBeenCalled();
  });

  it("uses only a chunk's view, excluding unrelated bytes in its underlying buffer", async () => {
    const bytes = Uint8Array.of(99, 1, 2, 99);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => body([bytes.subarray(1, 3)])),
    );
    const result = await new DataFetcher().fetchURL(
      "https://maps.test/texture",
    );
    expect([...result.createTypedArray(Uint8Array)]).toEqual([1, 2]);
  });

  it("still retries truncated range responses outside the HTTP cache", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(body([Uint8Array.of(1, 2)], 206))
      .mockResolvedValueOnce(body([Uint8Array.of(1, 2, 3, 4)], 206));
    vi.stubGlobal("fetch", fetch);
    const result = await new DataFetcher().fetchURL(
      "https://maps.test/archive.vpk",
      { rangeStart: 8, rangeSize: 4 },
    );
    expect([...result.createTypedArray(Uint8Array)]).toEqual([1, 2, 3, 4]);
    expect(fetch).toHaveBeenCalledTimes(2);
    // Each range gets its own HTTP cache entry; concurrent ranges on one entry aren't cached.
    expect(fetch.mock.calls[0]![0].url).toBe(
      "https://maps.test/archive.vpk?range=8-11",
    );
    expect(fetch.mock.calls[1]![0].cache).toBe("no-store");
    expect(fetch.mock.calls[1]![0].headers.get("range")).toBe("bytes=8-11");
  });

  it("settles both queued and in-flight requests on cancellation without starting the queue", async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const fetcher = new DataFetcher();
    fetcher.maxParallelRequests = 1;
    const requests = [
      fetcher.fetchURL("https://maps.test/a"),
      fetcher.fetchURL("https://maps.test/b"),
    ];
    expect(fetch).toHaveBeenCalledOnce();
    fetcher.abort();
    const results = await Promise.all(requests);
    expect(results.map((bytes) => bytes.byteLength)).toEqual([0, 0]);
    expect(fetcher.requests).toHaveLength(0);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
