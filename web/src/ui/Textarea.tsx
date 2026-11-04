// A multi-line text field, styled like Input: tall for a post's text, short for a comment.
import type { ComponentProps } from "react";
import { classNames } from "./classNames";

const heights = { md: "min-h-40", sm: "min-h-20" };

export function Textarea({
  className,
  size = "md",
  ...props
}: ComponentProps<"textarea"> & { size?: keyof typeof heights }) {
  return (
    <textarea
      className={classNames(
        "border-border bg-bg text-text w-full rounded-md border px-3 py-2 text-sm leading-relaxed",
        heights[size],
        "placeholder:text-text-subtle transition-colors duration-(--duration-fast)",
        "hover:border-border-strong focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}
