// Which run a replay is measured against, for the HUD's deltas and the second route: the record on its map, style
// and track by default, or the next best when the replay is the record. Viewers can compare with any other run on
// the map by its ID or link, whatever its style or track.
import { api, type Schemas } from "@/api/client";

export interface ComparisonRun {
  runId: number;
  /** On its own board; null when it isn't known. */
  rank: number | null;
  player: string;
  time: number;
  style: string;
  track: number;
}

export function comparisonRun(
  map: Schemas["MapDetail"],
  run: Schemas["RunDetail"],
): ComparisonRun | null {
  const board = map.tracks
    .find((track) => track.track === run.track)
    ?.styles.find((style) => style.style === run.style);
  if (!board) return null;
  const on = { style: run.style, track: run.track };
  const record = board.world_record;
  if (record.run_id !== run.id)
    return {
      runId: record.run_id,
      rank: 1,
      player: record.player.name,
      time: record.time,
      ...on,
    };
  const next = board.leaderboard.find((entry) => entry.run_id !== run.id);
  return next
    ? {
        runId: next.run_id,
        rank: next.rank,
        player: next.player.name,
        time: next.time,
        ...on,
      }
    : null;
}

/** A run that can be compared with `run`, with its replay's address, or why it can't. */
export async function findComparison(
  run: Schemas["RunDetail"],
  runId: number,
  signal: AbortSignal,
): Promise<{ comparison: ComparisonRun; replayUrl: string } | string> {
  if (runId === run.id) return "That's the run being watched.";
  const { data: other, response } = await api.GET("/v1/runs/{id}", {
    params: { path: { id: runId } },
    signal,
  });
  if (response.status === 404) return `There's no run ${runId}.`;
  if (!other) return "The run couldn't be loaded. Try again.";
  if (other.map !== run.map) return `Run ${runId} is on ${other.map}.`;
  if (!other.replay) return `Run ${runId} has no replay.`;
  return {
    comparison: {
      runId,
      rank: other.rank ?? null,
      player: other.player.name,
      time: other.time,
      style: other.style,
      track: other.track,
    },
    replayUrl: other.replay.sjr_url,
  };
}
