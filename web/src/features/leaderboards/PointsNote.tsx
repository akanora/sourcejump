// How points are counted, in plain words, from the formula the API uses. Says so while it's still a draft.
import type { Schemas } from "@/api/client";

const numbers = new Intl.NumberFormat("en");

export function PointsNote({
  formula,
  legacy,
}: {
  formula: Schemas["PointsFormula"];
  /** The pre-2.0 view, counted on the old site's tiers. */
  legacy: boolean;
}) {
  const growth = formula.growth_percent / 100;
  const perTier =
    growth === 2 ? "doubles" : `grows ${numbers.format(growth)} times`;
  return (
    <div className="text-text-muted flex flex-col gap-1 text-sm">
      {formula.draft && (
        <p className="text-text">
          Points are a draft until the community agrees on a formula.
        </p>
      )}
      <p>
        A tier 1 map is worth {numbers.format(formula.base)} points, and the
        value {perTier} with each tier up. Finishing a map earns{" "}
        {formula.finish_percent}% of its value; the rest is for speed, all of it
        at the world record and less the further behind you are. A bonus is
        worth {formula.bonus_percent}% of a map at its own tier.{" "}
        {legacy
          ? "Pre-2.0 records are counted on the old site's tiers and never count toward 2.0."
          : "Each style counts on its own, and pre-2.0 runs don't count."}
      </p>
      {!legacy && !formula.tiers && <p>Points start once maps have tiers.</p>}
    </div>
  );
}
