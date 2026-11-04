"use client";
// The step chart with made-up records: formatting functions can't be passed from the server page.
import { formatTime } from "@/features/runs/time";
import { StepChart } from "@/ui/StepChart";

const day = 86_400_000;
const start = Date.UTC(2026, 5, 1);
const records = [92.4, 88.1, 87.9, 84.5, 84.2, 81.03];

export function StepChartDemo() {
  return (
    <StepChart
      label="Example world record history"
      end={start + 140 * day}
      onOpen={() => undefined}
      formatValue={formatTime}
      formatDate={(ms) => new Date(ms).toISOString().slice(0, 10)}
      points={records.map((time, index) => ({
        x: start + index * 22 * day,
        y: time,
        id: String(index),
        label: `Record ${index + 1}: ${formatTime(time)}`,
        detail: `Record ${index + 1}`,
      }))}
    />
  );
}
