// Players page: how many players have a recorded time over time, search by name or SteamID, and recently
// active players; for staff, a Banned tab.
import type { Metadata } from "next";
import { Suspense } from "react";
import { DailyTotals } from "@/features/dailyTotals/DailyTotals";
import { PlayerSearch } from "@/features/players/PlayerSearch";
import { Page } from "@/ui/Page";

export const metadata: Metadata = {
  title: "Players",
  description: "Find a player by name or SteamID.",
};

export default function PlayersPage({ searchParams }: PageProps<"/players">) {
  return (
    <Page className="gap-6">
      <h1 className="text-3xl font-bold">Players</h1>
      <Suspense>
        <DailyTotals kind="players" />
      </Suspense>
      <Suspense>
        {searchParams.then(({ q, view }) => (
          <PlayerSearch
            q={typeof q === "string" ? q : ""}
            banned={view === "banned"}
          />
        ))}
      </Suspense>
    </Page>
  );
}
