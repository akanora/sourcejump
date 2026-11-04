// Dividing lines that run to the edges of the Card or Dialog around them, past its side padding.
import type { ComponentProps, ReactNode } from "react";
import { classNames } from "./classNames";

// Card and the Dialog body both pad their sides by 5 (20px). `-mx-5` undoes that padding and `px-5` gives it
// back inside, so a line spans the whole surface while the text stays aligned with the rest of it.

/** Rows with a line between each: a list, a definition list or plain rows. Rows set their own vertical padding. */
export function DividedList({
  as: Element = "ul",
  className,
  children,
}: {
  as?: "ul" | "ol" | "dl" | "div";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Element
      className={classNames("divide-border -mx-5 divide-y *:px-5", className)}
    >
      {children}
    </Element>
  );
}

/** A part set off by a line above it, such as a card's actions under its content. */
export function DividedSection({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={classNames(
        "border-border -mx-5 border-t px-5 pt-3",
        className,
      )}
      {...props}
    />
  );
}
