// Map preparation and replay fetching overlap; either failure cancels the other and frees the renderer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { startViewer, type ViewerEvents } from "./session";
import { loadReplay, type Replay } from "./sjr";

const { load, dispose } = vi.hoisted(() => ({
  load: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./renderer", () => ({
  Renderer: class {
    load = load;
    dispose = dispose;
  },
}));
vi.mock("./sjr", () => ({ loadReplay: vi.fn() }));

const source = {
  mapName: "map",
  mapUrl: "https://maps.test/map.bsp",
  stockContentUrl: "https://maps.test/stock",
  replayUrl: "https://maps.test/replay.sjr",
};
const start = () =>
  startViewer(
    {} as HTMLCanvasElement,
    source,
    {} as ViewerEvents,
    new AbortController().signal,
  );
afterEach(() => vi.resetAllMocks());

describe("viewer loading", () => {
  it("starts map preparation before the replay arrives and cancels it if the replay fails", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(loadReplay).mockReturnValue(
      new Promise<Replay>((_, reject) => {
        fail = reject;
      }),
    );
    load.mockImplementation(
      (_url, _name, signal: AbortSignal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const result = start();
    expect(load).toHaveBeenCalledWith(
      source.mapUrl,
      source.mapName,
      expect.any(AbortSignal),
    );
    expect(loadReplay).toHaveBeenCalledOnce();
    fail(new Error("replay unavailable"));
    await expect(result).rejects.toThrow("replay unavailable");
    expect(load.mock.calls[0]![2].aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("cancels a pending replay download when the map fails", async () => {
    load.mockRejectedValue(new Error("map unavailable"));
    vi.mocked(loadReplay).mockImplementation(
      (_url, signal) =>
        new Promise<Replay>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    await expect(start()).rejects.toThrow("map unavailable");
    expect(vi.mocked(loadReplay).mock.calls[0]![1].aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
