// A zone set drawn from above: each zone's box on the map's floor plan, with an earlier set dashed for comparison.
import type { Schemas } from "@/api/client";
import { classNames } from "@/ui/classNames";
import { boxes, type ZoneBox, zoneName } from "./zones";

const tones: Record<string, string> = {
  start: "fill-success/20 stroke-success",
  end: "fill-danger/20 stroke-danger",
};
const otherTone = "fill-warning/15 stroke-warning";

export function ZonePlan({
  zones,
  previous,
  className,
}: {
  zones: Schemas["Zone"][];
  /** Drawn dashed underneath, to show what moved. */
  previous?: Schemas["Zone"][];
  className?: string;
}) {
  const current = boxes(zones);
  const before = boxes(previous ?? []);
  const all = [...current, ...before];
  if (all.length === 0) {
    return (
      <p className="text-text-muted text-sm">
        These zones have no area to draw.
      </p>
    );
  }
  const minX = Math.min(...all.map((b) => b.minX));
  const maxX = Math.max(...all.map((b) => b.maxX));
  const minY = Math.min(...all.map((b) => b.minY));
  const maxY = Math.max(...all.map((b) => b.maxY));
  const pad = Math.max(maxX - minX, maxY - minY, 64) * 0.05;
  // Maps have y pointing north and SVG has it pointing down, so y is flipped.
  const viewBox = [
    minX - pad,
    -maxY - pad,
    maxX - minX + 2 * pad,
    maxY - minY + 2 * pad,
  ].join(" ");

  return (
    <div className={classNames("flex flex-col gap-2", className)}>
      <svg
        viewBox={viewBox}
        role="img"
        aria-label={`Zones from above: ${current.map((b) => zoneName(b.zone)).join(", ")}`}
        className="bg-bg border-border h-72 w-full rounded-md border"
        preserveAspectRatio="xMidYMid meet"
      >
        {before.map((box, i) => (
          <Box
            key={`before-${i}`}
            box={box}
            className="stroke-text-muted fill-none"
            dashed
          />
        ))}
        {current.map((box, i) => (
          <Box
            key={`now-${i}`}
            box={box}
            className={tones[box.zone.type] ?? otherTone}
          />
        ))}
      </svg>
      <ul className="text-text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="bg-success size-2 rounded-sm" /> Start
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="bg-danger size-2 rounded-sm" /> End
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="bg-warning size-2 rounded-sm" /> Other
        </li>
        {before.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="border-text-muted size-2 rounded-sm border border-dashed"
            />{" "}
            Version before
          </li>
        )}
      </ul>
    </div>
  );
}

function Box({
  box,
  className,
  dashed = false,
}: {
  box: ZoneBox;
  className: string;
  dashed?: boolean;
}) {
  return (
    <rect
      x={box.minX}
      y={-box.maxY}
      width={Math.max(box.maxX - box.minX, 1)}
      height={Math.max(box.maxY - box.minY, 1)}
      className={className}
      strokeWidth={1.5}
      strokeDasharray={dashed ? "4 3" : undefined}
      vectorEffect="non-scaling-stroke"
    >
      <title>{`${zoneName(box.zone)}, id ${box.zone.id}`}</title>
    </rect>
  );
}
