"use client";
// A map's world record over time, for one style and track, or its pre-2.0 board's records. Hovering a point
// shows who set the record; clicking opens the run.
import type { Schemas } from "@/api/client";
import { openRun } from "@/features/runs/runDialog";
import { formatDate, formatTime } from "@/features/runs/time";
import { StepChart } from "@/ui/StepChart";

export function WrHistoryChart({
  records,
  end,
  legacy = false,
}: {
  records: Schemas["WrHistoryEntry"][];
  /** Pre-2.0 records, whose run IDs are the old site's. */
  legacy?: boolean;
  /** The current record's step runs on to here: the map's latest run, since the record held through it. */
  end: string | undefined;
}) {
  return (
    <StepChart
      label={`${legacy ? "Pre-2.0 record" : "World record"} history. Each point is a record; open one to see its run.`}
      end={end ? Date.parse(end) : 0}
      formatValue={formatTime}
      formatDate={(ms) => formatDate(new Date(ms).toISOString())}
      onOpen={(point) => openRun(Number(point.id), { legacy })}
      points={records.map((record) => ({
        x: Date.parse(record.finished_at),
        y: record.time,
        id: String(record.run_id),
        label: `${formatTime(record.time)} by ${record.player.name}, ${formatDate(record.finished_at)}`,
        detail: (
          <span className="flex flex-col gap-0.5">
            <span className="text-text">{record.player.name}</span>
            <span>
              {formatDate(record.finished_at)}
              {record.improvement != null && (
                <span className="text-success">
                  {" "}
                  −{formatTime(record.improvement)}
                </span>
              )}
            </span>
          </span>
        ),
      }))}
    />
  );
}
