"use client";
// One leaderboard in full, as a table: the first 50 come with the page and "Show more" loads 50 at a time.
// Beside each player's points and completions, their share of the tracks and their world records.
import { type CSSProperties, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { Medal } from "@/ui/Medal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import { LIST_PAGE_SIZE as PAGE_SIZE } from "./BoardChoices";

const numbers = new Intl.NumberFormat("en");
const percent = new Intl.NumberFormat("en", { style: "percent" });

type List = Schemas["LeaderboardList"];

/** Give it a `key` per board, so another choice starts again from the top. */
export function StandingsTable({
  first,
  completedLabel,
}: {
  first: List;
  /** "Completed maps" or "Completed bonuses". */
  completedLabel: string;
}) {
  const [standings, setStandings] = useState(first.standings);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const byPoints = first.ranking === "points";
  const legacy = first.view === "legacy";

  async function showMore() {
    setLoading(true);
    setFailed(false);
    const loaded = await api
      .GET("/v1/leaderboards/{ranking}", {
        params: {
          path: { ranking: first.ranking },
          query: {
            ...(legacy
              ? { view: "legacy" }
              : {
                  style: first.style ?? undefined,
                  track: first.track,
                  view: "current",
                }),
            limit: PAGE_SIZE,
            offset: standings.length,
          },
        },
      })
      .then((result) => result.data)
      .catch(() => undefined);
    setLoading(false);
    if (loaded) setStandings((shown) => [...shown, ...loaded.standings]);
    else setFailed(true);
  }

  // The ranked value comes first after the player, the other one after it.
  const pointsCell = (standing: Schemas["ListedStanding"]) => (
    <TableCell numeric className={byPoints ? "font-bold" : "text-text-muted"}>
      {numbers.format(standing.points)}
    </TableCell>
  );
  const completedCell = (standing: Schemas["ListedStanding"]) => (
    <TableCell numeric className={byPoints ? "text-text-muted" : "font-bold"}>
      {numbers.format(standing.completed)}
      {first.out_of > 0 && (
        <span className="text-text-subtle ml-2 font-normal">
          {percent.format(standing.completed / first.out_of)}
        </span>
      )}
    </TableCell>
  );

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell className="w-16">Rank</TableHeaderCell>
            {/* The player column takes the spare width, so the numbers sit together on the right, evenly spaced. */}
            <TableHeaderCell className="w-full">Player</TableHeaderCell>
            {byPoints ? (
              <>
                <TableHeaderCell numeric>Points</TableHeaderCell>
                <TableHeaderCell numeric>{completedLabel}</TableHeaderCell>
              </>
            ) : (
              <>
                <TableHeaderCell numeric>{completedLabel}</TableHeaderCell>
                <TableHeaderCell numeric>Points</TableHeaderCell>
              </>
            )}
            {!legacy && (
              <TableHeaderCell numeric>World records</TableHeaderCell>
            )}
          </tr>
        </TableHead>
        <TableBody>
          {standings.map((standing, index) => (
            <TableRow
              key={standing.player.steamid64}
              className="motion-enter"
              // Rows loaded by "Show more" stagger from the first new one, not from the top.
              style={
                {
                  "--motion-delay": `${Math.min(index % PAGE_SIZE, 12) * 20}ms`,
                } as CSSProperties
              }
            >
              <TableCell>
                <Medal placement={standing.rank} />
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <Link
                    href={`/players/${standing.player.steamid64}`}
                    className="hover:text-accent flex items-center gap-3"
                  >
                    <Avatar
                      name={standing.player.name}
                      src={standing.player.avatar_url ?? undefined}
                      size="sm"
                    />
                    {standing.player.name}
                  </Link>
                  <Flag code={standing.player.country_code} />
                </span>
              </TableCell>
              {byPoints ? (
                <>
                  {pointsCell(standing)}
                  {completedCell(standing)}
                </>
              ) : (
                <>
                  {completedCell(standing)}
                  {pointsCell(standing)}
                </>
              )}
              {!legacy && (
                <TableCell numeric className="text-text-muted">
                  {numbers.format(standing.world_records ?? 0)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-muted text-sm tabular-nums">
          {standings.length >= first.total
            ? `All ${numbers.format(first.total)} players`
            : `Top ${numbers.format(standings.length)} of ${numbers.format(first.total)} players`}
        </span>
        {failed && (
          <span className="text-danger text-sm">
            More couldn&apos;t be loaded. Try again.
          </span>
        )}
        {standings.length < first.total && (
          <Button size="sm" onClick={() => void showMore()} disabled={loading}>
            {loading ? "Loading…" : "Show more"}
          </Button>
        )}
      </div>
    </div>
  );
}
