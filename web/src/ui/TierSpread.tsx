// How many maps hold each tier: a donut split by tier, each slice in its tier's color, beside each tier's count and
// share. Every slice and row links to the maps of that tier; the chosen tier stays bright and the others dim.
// Maps without a tier fill the donut's end in a neutral color.
import type { CSSProperties } from "react";
import { classNames } from "./classNames";
import { Link } from "./Link";
import { TierBadge, tierColor } from "./TierBadge";

/** Each tier's share of all maps, so the shares (with "No tier") add up to the whole list. */
const percent = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("en");

/** The ring's radius and width, in the SVG's 100-unit box. */
const RADIUS = 40;
const WIDTH = 16;
/** Space between slices, in hundredths of the ring. */
const GAP = 0.6;

const rowClasses =
  "col-span-3 grid grid-cols-subgrid items-center rounded-md px-2 py-0.5 transition-opacity duration-(--duration-base)";

export function TierSpread({
  byTier,
  untiered,
  selected,
  tierHref,
}: {
  /** Maps per tier, tier 1 first; its length is the tier count. */
  byTier: number[];
  untiered: number;
  /** The tier the list is filtered to, if any. */
  selected?: number;
  /** Where a tier leads; null for the whole list. */
  tierHref: (tier: number | null) => string;
}) {
  const total = byTier.reduce((sum, count) => sum + count, untiered);
  if (total === 0) return null;
  const tierCount = byTier.length;
  const dimmed = (tier: number) => selected != null && selected !== tier;

  // Each slice is a dashed stroke around the ring: as long as its share, starting where the last one ended.
  // Strokes rather than wedge paths, so a slice is one circle and grows its width on hover.
  const slices = byTier.map((count, index) => ({
    tier: index + 1,
    count,
    start:
      (byTier.slice(0, index).reduce((sum, c) => sum + c, 0) / total) * 100,
    length: (count / total) * 100,
  }));
  const tieredShare = (byTier.reduce((sum, c) => sum + c, 0) / total) * 100;
  const chosen = selected != null ? byTier[selected - 1] : undefined;
  const half = Math.ceil(tierCount / 2);
  const tierRow = ({ tier, count }: (typeof slices)[number]) => (
    <li key={tier} className="col-span-3 grid grid-cols-subgrid">
      <Link
        href={tierHref(selected === tier ? null : tier)}
        scroll={false}
        aria-current={selected === tier ? "true" : undefined}
        className={classNames(
          rowClasses,
          "hover:bg-surface-raised",
          selected === tier && "bg-surface-raised",
          dimmed(tier) && "opacity-40 hover:opacity-100",
        )}
      >
        <TierBadge tier={tier} tierCount={tierCount} />
        <span className="text-right tabular-nums">{number.format(count)}</span>
        <span className="text-text-subtle tabular-nums">
          {percent.format(count / total)}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="flex min-w-0 flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg
        viewBox="0 0 100 100"
        className="size-36 shrink-0 -rotate-90"
        role="img"
        aria-label={`Maps per tier, ${tierCount} tiers`}
      >
        {untiered > 0 && (
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            pathLength={100}
            strokeWidth={WIDTH}
            className="stroke-surface-raised"
            strokeDasharray={`${Math.max((untiered / total) * 100 - GAP, 0)} 100`}
            strokeDashoffset={-tieredShare}
          />
        )}
        {slices.map(
          ({ tier, count, start, length }) =>
            count > 0 && (
              <Link
                key={tier}
                href={tierHref(selected === tier ? null : tier)}
                scroll={false}
                aria-label={`Tier ${tier}: ${number.format(count)} maps`}
              >
                <title>{`Tier ${tier}: ${number.format(count)} maps`}</title>
                <circle
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  pathLength={100}
                  strokeWidth={WIDTH}
                  // Very small tiers still show as a sliver rather than vanishing into the gap.
                  strokeDasharray={`${Math.max(length - GAP, 0.3)} 100`}
                  strokeDashoffset={-start}
                  style={
                    { "--tier": tierColor(tier, tierCount) } as CSSProperties
                  }
                  className={classNames(
                    "stroke-(--tier) transition-[opacity,stroke-width] duration-(--duration-base) hover:stroke-[19]",
                    dimmed(tier) && "opacity-25",
                    selected === tier && "stroke-[19]",
                  )}
                />
              </Link>
            ),
        )}
        {/* Counter-rotated, so the middle reads upright inside the turned ring. */}
        <g className="[transform-origin:50px_50px] rotate-90">
          <text
            x="50"
            y={chosen != null ? 48 : 54}
            textAnchor="middle"
            className="fill-text text-[13px] font-bold tabular-nums"
          >
            {selected != null ? `T${selected}` : "All"}
          </text>
          {chosen != null && (
            <text
              x="50"
              y="61"
              textAnchor="middle"
              className="fill-text-muted text-[8px] tabular-nums"
            >
              {number.format(chosen)} maps
            </text>
          )}
        </g>
      </svg>

      {/* "All", always there to go back to, heads the first column and "No tier" the second; the tiers split
          evenly below them, low tiers first. One column on phones, with "No tier" last. */}
      <ul
        style={{ "--rows": half + 1 } as CSSProperties}
        className="grid grid-cols-[auto_auto_auto] gap-x-3 gap-y-0.5 text-sm sm:grid-flow-col sm:grid-cols-[auto_auto_auto_auto_auto_auto] sm:grid-rows-[repeat(var(--rows),auto)] sm:gap-x-2"
      >
        <li className="col-span-3 grid grid-cols-subgrid">
          <Link
            href={tierHref(null)}
            scroll={false}
            aria-current={selected == null ? "true" : undefined}
            className={classNames(
              rowClasses,
              "hover:bg-surface-raised font-bold",
              selected == null && "bg-surface-raised",
            )}
          >
            All
            <span className="text-right tabular-nums">
              {number.format(total - untiered)}
            </span>
          </Link>
        </li>
        {slices.slice(0, half).map(tierRow)}
        {untiered > 0 ? (
          <li
            className={classNames(
              rowClasses,
              "text-text-muted order-last sm:order-none",
              selected != null && "opacity-40",
            )}
          >
            No tier
            <span className="text-right tabular-nums">
              {number.format(untiered)}
            </span>
            <span className="text-text-subtle tabular-nums">
              {percent.format(untiered / total)}
            </span>
          </li>
        ) : (
          <li aria-hidden className="hidden sm:col-span-3 sm:block" />
        )}
        {slices.slice(half).map(tierRow)}
      </ul>
    </div>
  );
}
