// A player's picture, or their initials when there is none.
import { classNames } from "./classNames";

type Size = "sm" | "md" | "lg" | "xl";

const sizes: Record<Size, string> = {
  sm: "size-6 text-xs",
  md: "size-8 text-xs",
  lg: "size-12 text-base",
  xl: "size-24 text-2xl",
};

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string;
  size?: Size;
  className?: string;
}) {
  const classes = classNames(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-raised font-bold text-text-muted",
    sizes[size],
    className,
  );
  if (src) {
    // Steam serves avatars pre-sized from its CDN, so next/image's resizing would add nothing.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={classes} />;
  }
  return (
    <span aria-hidden className={classes}>
      {initials(name)}
    </span>
  );
}

/** First letter of the first two words: "strafe cat" is "SC", "nova" is "N". */
function initials(name: string): string {
  const words = name.split(/[\s_.-]+/);
  const letters = words.map((word) => word.match(/\p{L}|\p{N}/u)?.[0]);
  return letters.filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}
