// A native drop-down for a form, styled like Input: the browser's own list, which suits long lists (countries)
// and phones. For choices that change a view in place, use ChoiceMenu instead.
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { classNames } from "./classNames";

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <span className={classNames("relative flex items-center", className)}>
      <select
        className={classNames(
          "border-border bg-bg text-text h-10 w-full appearance-none rounded-md border pr-9 pl-3 text-sm",
          "transition-colors duration-(--duration-fast)",
          "hover:border-border-strong focus:border-accent focus:outline-none",
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="text-text-subtle pointer-events-none absolute right-3 size-4"
      />
    </span>
  );
}
