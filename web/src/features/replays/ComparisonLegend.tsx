// Which run is which over a replay that's compared with another: each run's colour, player and time, as its route
// and player box are drawn. The compared run's style and track show when they differ from the watched run's.
// Clicking a run follows it: the view and the HUD switch to that player.
import { Eye } from "lucide-react";
import type { Schemas } from "@/api/client";
import { formatTime, trackName } from "@/features/runs/time";
import { classNames } from "@/ui/classNames";
import type { ComparisonRun } from "./comparison";
import type { Follow } from "./viewer/session";

export function ComparisonLegend({
  run,
  comparison,
  styleNames,
  follow,
  onFollow,
}: {
  run: Schemas["RunDetail"];
  comparison: ComparisonRun;
  styleNames: Record<string, string>;
  follow: Follow;
  onFollow: (follow: Follow) => void;
}) {
  const differs = [
    comparison.style !== run.style &&
      (styleNames[comparison.style] ?? comparison.style),
    comparison.track !== run.track && trackName(comparison.track),
  ].filter(Boolean);
  return (
    <div
      role="group"
      aria-label="Whose view"
      className="bg-bg/80 border-text/10 motion-enter absolute top-3 right-3 flex max-w-72 flex-col gap-0.5 rounded-md border p-1 text-xs backdrop-blur-xs"
    >
      <Row
        swatch="bg-accent"
        player={run.player.name}
        time={run.time}
        followed={follow === "run"}
        onClick={() => onFollow("run")}
      />
      <Row
        swatch="bg-warning"
        player={comparison.player}
        time={comparison.time}
        note={differs.join(" · ")}
        followed={follow === "compared"}
        onClick={() => onFollow("compared")}
      />
    </div>
  );
}

function Row({
  swatch,
  player,
  time,
  note,
  followed,
  onClick,
}: {
  swatch: string;
  player: string;
  time: number;
  note?: string;
  followed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={followed}
      title={followed ? `Watching ${player}` : `Watch from ${player}'s view`}
      onClick={onClick}
      className={classNames(
        "flex items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors duration-(--duration-fast)",
        followed ? "bg-text/10 text-text" : "text-text-muted hover:bg-text/5",
      )}
    >
      <span
        aria-hidden
        className={classNames("size-2 shrink-0 rounded-full", swatch)}
      />
      <span className="min-w-0 truncate">{player}</span>
      <span className="ml-auto pl-2 tabular-nums">{formatTime(time)}</span>
      {note && <span className="text-text-subtle">{note}</span>}
      <Eye
        aria-hidden
        className={classNames(
          "size-3.5 shrink-0",
          followed ? "text-text" : "invisible",
        )}
      />
    </button>
  );
}
