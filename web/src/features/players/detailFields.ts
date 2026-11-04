// A profile's details, in the order they're shown and asked for, with their labels.
import type { Schemas } from "@/api/client";

export const detailFields = [
  { key: "mouse", label: "Mouse" },
  { key: "dpi", label: "DPI" },
  { key: "sensitivity", label: "Sensitivity" },
  { key: "mouse_pad", label: "Mouse pad" },
  { key: "keyboard", label: "Keyboard" },
  { key: "monitor", label: "Monitor" },
  { key: "aspect", label: "Aspect" },
] as const satisfies { key: keyof Schemas["PlayerDetails"]; label: string }[];
