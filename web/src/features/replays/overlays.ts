// Which overlays the replay player draws (`viewer/session.ts`), remembered per browser.
import type { Overlays } from "./viewer/session";

const KEY = "sj.replay.overlays";

export function storedOverlays(): Overlays {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<
      Record<keyof Overlays, unknown>
    >;
    return { paths: stored.paths === true, players: stored.players === true };
  } catch {
    return { paths: false, players: false };
  }
}

export function storeOverlays(overlays: Overlays): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(overlays));
  } catch {
    // Not remembered; it still applies to this replay.
  }
}
