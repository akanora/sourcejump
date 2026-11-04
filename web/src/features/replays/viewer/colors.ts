// Design tokens as the 0–1 RGB the renderer draws with, so beams and markers match the page's colours.

/** A `--color-*` token, which the theme defines as #rrggbb. */
export function tokenColor(name: string): [number, number, number] {
  const hex = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
