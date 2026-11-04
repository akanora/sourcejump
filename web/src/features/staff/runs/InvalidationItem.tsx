// One invalidation that still holds runs out: what it took, who did it, when and why, and Restore. Listed on a
// player's Manage view and in a server's details.
import type { Schemas } from "@/api/client";
import { RunLink } from "@/features/runs/RunLink";
import { formatDate, formatTime, trackName } from "@/features/runs/time";
import { RestoreInvalidation } from "./RestoreInvalidation";

type Invalidation = Schemas["InvalidationEntry"];

export function InvalidationItem({
  entry,
  canRestore,
}: {
  entry: Invalidation;
  /** Whether the signed-in staff member holds invalidate_runs. */
  canRestore: boolean;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <p>
          <What entry={entry} />
        </p>
        <p className="text-text-muted text-sm">
          {entry.reason && `${entry.reason} · `}
          {entry.actor?.name ?? "Command line"}, {formatDate(entry.at)}
          {entry.still_invalid < entry.runs &&
            ` · ${(entry.runs - entry.still_invalid).toLocaleString("en")} restored since`}
        </p>
      </div>
      {canRestore && (
        <RestoreInvalidation
          target={
            entry.run ? { run: entry.run.id } : { invalidation: entry.id }
          }
          runs={entry.still_invalid}
        />
      )}
    </li>
  );
}

function What({ entry }: { entry: Invalidation }) {
  if (entry.run) {
    const run = entry.run;
    return (
      <>
        <RunLink runId={run.id} className="hover:text-accent">
          {formatTime(run.time)} on {run.map}
        </RunLink>{" "}
        <span className="text-text-muted">
          ({run.style}, {trackName(run.track).toLowerCase()})
        </span>
      </>
    );
  }
  const runs = runCount(entry.still_invalid);
  switch (entry.action) {
    case "ban_player":
      return <>{runs} sent during their ban</>;
    case "invalidate_key_runs":
      return (
        <>
          {runs} sent with key{" "}
          <code className="text-text-muted tabular-nums">{entry.key}…</code>
        </>
      );
    case "invalidate_server_runs":
      return <>{runs} sent by this server</>;
    default:
      return <>{runs}, all at once</>;
  }
}

function runCount(runs: number): string {
  return `${runs.toLocaleString("en")} ${runs === 1 ? "run" : "runs"}`;
}
