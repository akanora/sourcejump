"use client";
// Which runs a board or profile shows: 2.0 by default, or with pre-2.0 runs, or those alone (lead,
// 2026-10-26). Only the normal style's main track has the other views, since the old site had no styles or
// bonuses.
import { ChoiceMenu } from "@/ui/ChoiceMenu";

export type View = "current" | "all" | "legacy";

/** The style legacy runs belong to, on the main track. */
export const LEGACY_STYLE = "normal";

const views: { value: View; label: string }[] = [
  { value: "current", label: "2.0" },
  { value: "all", label: "2.0 + pre-2.0" },
  { value: "legacy", label: "Pre-2.0" },
];

/** The view an address asks for, or `fallback` when it names none or one that doesn't exist. */
export function viewFrom(param: string | null, fallback: View): View {
  return views.find((v) => v.value === param)?.value ?? fallback;
}

/** The "Runs" menu beside a board's style and track. It shows on every board so it doesn't come and go;
 * where there are no pre-2.0 runs it stays on 2.0 with the other views muted (lead, 2026-10-26). */
export function ViewMenu({
  value,
  available,
  onChange,
}: {
  value: View;
  /** Whether this board has the pre-2.0 views. */
  available: boolean;
  onChange: (view: View) => void;
}) {
  return (
    <ChoiceMenu
      label="Runs"
      options={views.map((view) => ({
        ...view,
        disabled: !available && view.value !== "current",
      }))}
      value={value}
      onChange={(next) => onChange(viewFrom(next, "current"))}
    />
  );
}
