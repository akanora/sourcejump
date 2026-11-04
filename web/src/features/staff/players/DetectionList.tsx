"use client";
// One player's anti-cheat detections on their Manage view: the first 50 as the page read them, then Load more
// for the next 50 at a time, read in the browser. Each is the anti-cheat's own text, with where and when.
import { useState } from "react";
import { api, type Schemas } from "@/api/client";
import { formatDateTime, formatSince } from "@/features/runs/time";
import { Button } from "@/ui/Button";
import { DividedList } from "@/ui/Divided";
import { Link } from "@/ui/Link";
import { Tooltip } from "@/ui/Tooltip";

type Page = Schemas["Detections"];
type Detection = Schemas["Detection"];

export function DetectionList({
  player,
  first,
}: {
  player: Schemas["PlayerRef"];
  first: Page;
}) {
  const [pages, setPages] = useState<Page[]>([first]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const detections = pages.flatMap((page) => page.detections);
  const older = pages[pages.length - 1]?.older;

  async function loadMore() {
    if (!older) return;
    setLoading(true);
    setFailed(false);
    const result = await api
      .GET("/v1/staff/players/{player}/detections", {
        params: {
          path: { player: player.steamid64 },
          query: { before: older },
        },
      })
      .catch(() => undefined);
    setLoading(false);
    const page = result?.data;
    if (page) setPages((current) => [...current, page]);
    else setFailed(true);
  }

  if (detections.length === 0) {
    return (
      <p className="text-text-muted text-sm">
        No anti-cheat detections for this player.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <DividedList as="ul">
        {detections.map((detection) => (
          <DetectionItem
            key={detection.id}
            detection={detection}
            current={player.name}
          />
        ))}
      </DividedList>
      {failed && (
        <p className="text-danger text-sm">
          Older detections couldn&apos;t be loaded. Try again.
        </p>
      )}
      {older && (
        <Button
          size="sm"
          variant="ghost"
          className="self-center"
          onClick={loadMore}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

/** `current` is the player's name now; the name they had on the server is shown when it differs. */
function DetectionItem({
  detection,
  current,
}: {
  detection: Detection;
  current: string;
}) {
  return (
    <li className="flex items-baseline gap-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="break-words">{detection.message}</p>
        <p className="text-text-subtle text-sm">
          <Link href={`/maps/${detection.map}`} className="hover:text-accent">
            {detection.map}
          </Link>{" "}
          on {detection.server.name}
          {detection.player_name !== current && (
            <> as {detection.player_name}</>
          )}
        </p>
      </div>
      <Tooltip
        content={`Detected ${formatDateTime(detection.detected_at)} by the server's clock, received ${formatDateTime(detection.received_at)}`}
      >
        {/* Rendered on the server and again in the browser, which can be a minute later; either is right. */}
        <time
          dateTime={detection.detected_at}
          tabIndex={0}
          suppressHydrationWarning
          className="text-text-subtle rounded-sm text-sm whitespace-nowrap"
        >
          {formatSince(detection.detected_at)}
        </time>
      </Tooltip>
    </li>
  );
}
