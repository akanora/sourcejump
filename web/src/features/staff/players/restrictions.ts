// What each ban restriction is called on the staff pages. The API sends restrictions by their stable names.
import type { Schemas } from "@/api/client";

export const restrictionLabels: Record<Schemas["Restriction"], string> = {
  no_records: "Records",
  no_posting: "Posting",
  no_profile_edits: "Profile details",
};

/** "Records and posting", for a ban's restrictions. */
export function restrictionList(
  restrictions: readonly Schemas["Restriction"][],
): string {
  const text = new Intl.ListFormat("en").format(
    restrictions.map((r) => restrictionLabels[r].toLowerCase()),
  );
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Reads a restriction list out of a log entry's detail, skipping anything that isn't one. */
export function restrictionsIn(value: unknown): Schemas["Restriction"][] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (name): name is Schemas["Restriction"] =>
      typeof name === "string" && name in restrictionLabels,
  );
}
