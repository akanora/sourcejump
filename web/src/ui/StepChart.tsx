"use client";
// A value that only changes in steps over time, e.g. a map's world record. Each step is a point that opens a page.
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { classNames } from "./classNames";

export interface StepPoint {
  /** Milliseconds since the epoch. */
  x: number;
  y: number;
  /** Tells points apart; passed back to `onOpen`. */
  id: string;
  /** Under the value in the tooltip, e.g. who set it and when. */
  detail: ReactNode;
  /** Read out for the point, since the chart itself is a picture. */
  label: string;
}

const height = 200;
const pad = { top: 12, right: 16, bottom: 28, left: 72 };

/**
 * Lower values sit lower, so a falling line reads as progress. The last step runs on to `end` (usually
 * now), since the last value still holds. Anywhere over the chart, a crosshair snaps to the nearest point
 * and its tooltip shows; clicking opens that point. Points also take keyboard focus, and Enter opens them.
 */
export function StepChart({
  points,
  end,
  formatValue,
  formatDate,
  label,
  onOpen,
}: {
  /** Opens a point, e.g. the run that set the record. */
  onOpen: (point: StepPoint) => void;
  /** Oldest first. */
  points: StepPoint[];
  end: number;
  formatValue: (value: number) => string;
  formatDate: (ms: number) => string;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [active, setActive] = useState<number | null>(null);

  // Measured before the first paint: a frame at the default width overflows a phone screen, which makes mobile
  // browsers zoom the viewport out and abort the page fade ("Viewport size changed").
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;

  const xMin = first.x;
  const xMax = Math.max(end, last.x);
  const values = points.map((point) => point.y);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  // A margin above and below, and a range even when there's only one value.
  const yPad = (yMax - yMin) * 0.1 || Math.max(yMax * 0.02, 0.5);
  const plotWidth = Math.max(width - pad.left - pad.right, 1);
  const plotHeight = height - pad.top - pad.bottom;
  const x = (value: number) =>
    pad.left +
    (xMax === xMin ? 0 : ((value - xMin) / (xMax - xMin)) * plotWidth);
  const y = (value: number) =>
    pad.top + ((yMax + yPad - value) / (yMax - yMin + 2 * yPad)) * plotHeight;

  const path = points
    .map((point, index) => {
      const next = points[index + 1];
      const step = `L${x(point.x)},${y(point.y)}`;
      return next ? `${step} H${x(next.x)}` : `${step} H${x(xMax)}`;
    })
    .join(" ")
    .replace(/^L/, "M");
  const ticks = yMax === yMin ? [yMin] : [yMax, (yMax + yMin) / 2, yMin];

  function nearest(event: MouseEvent<SVGSVGElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = event.clientX - rect.left;
    let best = 0;
    points.forEach((point, index) => {
      const bestPoint = points[best];
      if (
        bestPoint &&
        Math.abs(x(point.x) - pointer) < Math.abs(x(bestPoint.x) - pointer)
      ) {
        best = index;
      }
    });
    return best;
  }

  function open(index: number) {
    const point = points[index];
    if (point) onOpen(point);
  }

  function onKeyDown(event: KeyboardEvent<SVGGElement>, index: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open(index);
    }
  }

  const shown = active === null ? undefined : points[active];
  // Near the top, the tooltip goes under the point so it stays inside the chart.
  const below = shown !== undefined && y(shown.y) < 72;

  return (
    <div ref={box} className="relative w-full">
      <svg
        role="group"
        aria-label={label}
        width={width}
        height={height}
        // The cap covers the server-rendered frame, drawn before anything can be measured.
        className="block max-w-full cursor-pointer overflow-visible"
        onPointerMove={(event) => setActive(nearest(event))}
        onPointerLeave={() => setActive(null)}
        onClick={(event) => open(nearest(event))}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={pad.left + plotWidth}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border"
            />
            <text
              x={pad.left - 8}
              y={y(tick)}
              dominantBaseline="middle"
              textAnchor="end"
              className="fill-text-subtle text-xs tabular-nums"
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}
        <text x={pad.left} y={height - 8} className="fill-text-subtle text-xs">
          {formatDate(xMin)}
        </text>
        <text
          x={pad.left + plotWidth}
          y={height - 8}
          textAnchor="end"
          className="fill-text-subtle text-xs"
        >
          {formatDate(xMax)}
        </text>
        {shown && (
          <line
            x1={x(shown.x)}
            x2={x(shown.x)}
            y1={pad.top}
            y2={pad.top + plotHeight}
            className="stroke-border-strong"
          />
        )}
        <path
          d={path}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-accent"
        />
        {points.map((point, index) => (
          <g
            key={point.id}
            role="link"
            tabIndex={0}
            aria-label={point.label}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="outline-none"
          >
            {/* A wider, invisible target, so a point is easy to hover and tap. */}
            <circle
              cx={x(point.x)}
              cy={y(point.y)}
              r={12}
              className="fill-transparent"
            />
            {active === index && (
              <circle
                cx={x(point.x)}
                cy={y(point.y)}
                r={10}
                className="fill-accent-soft stroke-accent/40"
              />
            )}
            <circle
              cx={x(point.x)}
              cy={y(point.y)}
              r={active === index ? 6 : 4}
              strokeWidth={2}
              className="fill-accent stroke-surface transition-[r] duration-(--duration-fast)"
            />
          </g>
        ))}
      </svg>
      {shown && (
        // The wrapper centers the tooltip above the point; the box inside runs the enter motion, which
        // also animates `translate` and would undo the centering if both were on one element.
        <div
          role="presentation"
          style={{
            left: Math.min(Math.max(x(shown.x), 90), width - 90),
            top: below ? y(shown.y) + 16 : y(shown.y) - 16,
          }}
          className={classNames(
            "pointer-events-none absolute z-10 -translate-x-1/2",
            !below && "-translate-y-full",
          )}
        >
          <div className="border-border-strong bg-surface-overlay shadow-popover motion-enter rounded-md border px-3 py-2 text-xs whitespace-nowrap">
            <p className="text-text text-sm font-bold tabular-nums">
              {formatValue(shown.y)}
            </p>
            <div className="text-text-muted">{shown.detail}</div>
          </div>
        </div>
      )}
    </div>
  );
}
