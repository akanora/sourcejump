// Joins class names, skipping falsy ones, so components can add classes conditionally.

/**
 * A `className` passed into a primitive is for placement (margins, grid position, width), not for
 * restyling it. Conflicting utilities aren't merged, so a restyle would depend on CSS order.
 */
export function classNames(
  ...parts: (string | false | null | undefined)[]
): string {
  return parts.filter(Boolean).join(" ");
}
