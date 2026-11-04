// A player's pages: the header stays while the profile and the Manage view swap beneath it.
import { Suspense } from "react";
import { PlayerHeader } from "@/features/players/PlayerHeader";
import { Page } from "@/ui/Page";

export default function PlayerLayout({
  params,
  children,
}: LayoutProps<"/players/[steamid]">) {
  return (
    <Page className="gap-8">
      {/* Holds the header's height (its avatar's), so the profile below doesn't jump when the header arrives. */}
      <Suspense fallback={<div aria-hidden className="h-24" />}>
        {params.then(({ steamid }) => (
          <PlayerHeader steamid={decodeURIComponent(steamid)} />
        ))}
      </Suspense>
      {children}
    </Page>
  );
}
