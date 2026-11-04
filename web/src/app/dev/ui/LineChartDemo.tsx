"use client";
// Line chart sample for the style guide: a day of made-up player counts, fixed so screenshots stay stable.
import { useState } from "react";
import { LineChart } from "@/ui/LineChart";

const counts = [
  12, 9, 7, 6, 6, 8, 11, 15, 18, 22, 25, 27, 30, 34, 38, 41, 44, 46, 43, 38, 31,
  24, 18, 14,
];
const points = counts.map((y, index) => ({ x: index * 3_600_000, y }));

export function LineChartDemo() {
  const [active, setActive] = useState<number | null>(null);
  const shown = points[active ?? points.length - 1];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm tabular-nums">
        <span className="font-bold">{shown?.y}</span>{" "}
        <span className="text-text-muted">
          players at {String(active ?? points.length - 1).padStart(2, "0")}:00
        </span>
      </p>
      <LineChart
        label="Sample: players online over a day"
        points={points}
        active={active}
        onActive={setActive}
        formatValue={(value) => String(value)}
      />
    </div>
  );
}
