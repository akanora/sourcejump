// A map's release date as precisely as staff know it: "2015", "Jun 2015" or "Jun 14, 2015".
import type { Schemas } from "@/api/client";

// UTC, so the server and every visitor see the same date.
const monthAndYear = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const fullDate = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function formatReleaseDate({
  year,
  month,
  day,
}: Schemas["ReleaseDate"]): string {
  if (month == null) return String(year);
  const date = new Date(Date.UTC(year, month - 1, day ?? 1));
  return (day == null ? monthAndYear : fullDate).format(date);
}

/** For `<time dateTime>`, which takes a year, a month or a day: "2015", "2015-06" or "2015-06-14". */
export function releaseDateTime({
  year,
  month,
  day,
}: Schemas["ReleaseDate"]): string {
  return [year, month, day]
    .filter((part) => part != null)
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}
