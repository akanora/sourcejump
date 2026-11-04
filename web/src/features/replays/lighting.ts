// Whether the 3D views (the replay player and the zone editor) draw maps lit or fullbright, remembered per
// browser: some maps are too dark to read.

export type Lighting = "lit" | "fullbright";

const KEY = "sj.viewer.lighting";

export const LIGHTING_OPTIONS: { value: Lighting; label: string }[] = [
  { value: "lit", label: "Lit" },
  { value: "fullbright", label: "Fullbright" },
];

export function storedLighting(): Lighting {
  try {
    return localStorage.getItem(KEY) === "fullbright" ? "fullbright" : "lit";
  } catch {
    return "lit";
  }
}

export function storeLighting(lighting: Lighting): void {
  try {
    localStorage.setItem(KEY, lighting);
  } catch {
    // Not remembered; it still applies to this view.
  }
}
