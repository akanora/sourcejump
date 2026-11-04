// CSS anchor names for popovers (Tooltip, Menu), which sit in the top layer and are placed next to their trigger.
import type { CSSProperties } from "react";

/** `useId` output isn't always a valid CSS identifier, so it's reduced to safe characters. */
export function anchorName(id: string): string {
  return `--anchor-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export function anchorStyle(id: string): CSSProperties {
  return { anchorName: anchorName(id) } as CSSProperties;
}

/** Places a popover by its trigger; `area` is a CSS `position-area` value. */
export function anchoredStyle(id: string, area: string): CSSProperties {
  return {
    positionAnchor: anchorName(id),
    positionArea: area,
    positionTryFallbacks: "flip-block, flip-inline",
  } as CSSProperties;
}
