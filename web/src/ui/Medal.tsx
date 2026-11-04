// A leaderboard placement: gold, silver and bronze medals for the top three, a plain number below that. Plain
// throughout for lists that aren't standings, such as a board's pre-2.0 views.
import { classNames } from "./classNames";

const medals = ["bg-gold", "bg-silver", "bg-bronze"];

export function Medal({
  placement,
  plain = false,
}: {
  placement: number;
  plain?: boolean;
}) {
  const medal = plain ? undefined : medals[placement - 1];
  return (
    <span
      aria-label={`Placement ${placement}`}
      className={classNames(
        // Fixed width either way, so names after the medal line up down the column.
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        medal ? `${medal} text-on-medal` : "text-text-muted",
      )}
    >
      {placement}
    </span>
  );
}
