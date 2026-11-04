"use client";
// When the map was released and who made it, shown under its name: edited here and saved with the button. The
// date takes a year, a month or a day, as precisely as staff know it; an empty field means unknown.
import { type FormEvent, useState } from "react";
import { type Schemas, api } from "@/api/client";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Link } from "@/ui/Link";
import { Select } from "@/ui/Select";
import { useStaffAction } from "../useStaffAction";

const monthNames = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, index, 1)),
  ),
);

export function ReleaseForm({
  map,
  released,
  mapper,
}: {
  map: string;
  released: Schemas["ReleaseDate"] | null | undefined;
  mapper: Schemas["PlayerRef"] | null | undefined;
}) {
  const [year, setYear] = useState(released ? String(released.year) : "");
  const [month, setMonth] = useState(released?.month ?? 0);
  const [day, setDay] = useState(released?.day ?? 0);
  const [steamId, setSteamId] = useState(mapper?.steamid64 ?? "");
  const action = useStaffAction();

  const date = toReleaseDate(year, month, day);
  const changed =
    JSON.stringify(date) !== JSON.stringify(normalized(released)) ||
    steamId.trim() !== (mapper?.steamid64 ?? "");
  const thisYear = new Date().getUTCFullYear();
  // Day 0 of the next month is the last of this one; a leap year's February has 29.
  const daysInMonth = month
    ? new Date(Date.UTC(Number(year) || 2000, month, 0)).getUTCDate()
    : 31;

  async function save(event: FormEvent) {
    event.preventDefault();
    await action.run(
      () =>
        api.PUT("/v1/staff/maps/{map}/release", {
          params: { path: { map } },
          body: { released: date, mapper: steamId.trim() || null },
        }),
      "The release couldn't be saved. Try again.",
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Year</span>
          <Input
            type="number"
            inputMode="numeric"
            min={1990}
            max={thisYear}
            value={year}
            onChange={(event) => setYear(event.target.value)}
            placeholder="Unknown"
            className="w-28"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Month</span>
          <Select
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
            disabled={!year}
            className="w-36"
          >
            <option value={0}>Unknown</option>
            {monthNames.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-muted">Day</span>
          <Select
            value={day}
            onChange={(event) => setDay(Number(event.target.value))}
            disabled={!year || !month}
            className="w-28"
          >
            <option value={0}>Unknown</option>
            {Array.from({ length: daysInMonth }, (_, index) => (
              <option key={index} value={index + 1}>
                {index + 1}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="text-text-muted">Mapper&apos;s SteamID</span>
          <Input
            value={steamId}
            onChange={(event) => setSteamId(event.target.value)}
            placeholder="76561197960287930, STEAM_0:1:… or [U:1:…]"
            spellCheck={false}
            className="min-w-56"
          />
        </label>
        <Button type="submit" disabled={action.busy || !changed}>
          {action.busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {mapper && (
        <p className="text-text-muted text-sm">
          Now credited to{" "}
          <Link
            href={`/players/${mapper.steamid64}`}
            className="text-text hover:text-accent transition-colors duration-(--duration-fast)"
          >
            {mapper.name}
          </Link>
          .
        </p>
      )}
      {action.error && <p className="text-danger text-sm">{action.error}</p>}
    </form>
  );
}

/** The fields as the API takes them: a month only with a year, a day only with a month (0 is unknown). */
function toReleaseDate(
  year: string,
  month: number,
  day: number,
): Schemas["ReleaseDate"] | null {
  if (!year.trim()) return null;
  return {
    year: Number(year),
    month: month || null,
    day: month && day ? day : null,
  };
}

function normalized(
  released: Schemas["ReleaseDate"] | null | undefined,
): Schemas["ReleaseDate"] | null {
  return released
    ? toReleaseDate(
        String(released.year),
        released.month ?? 0,
        released.day ?? 0,
      )
    : null;
}
