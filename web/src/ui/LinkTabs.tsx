// Tabs that are links: each view has its own address, e.g. a leaderboard's style and track, so it can be shared.
import type { ReactNode } from "react";
import { Link } from "./Link";
import { classNames } from "./classNames";
import { type TabVariant, tabStyles } from "./tabStyles";

export interface LinkTab {
  href: string;
  label: ReactNode;
  current: boolean;
}

/** Looks like Tabs, but is navigation: the current link carries `aria-current="page"`. */
export function LinkTabs({
  tabs,
  variant = "segmented",
  label,
  className,
}: {
  tabs: LinkTab[];
  variant?: TabVariant;
  /** Names the group for screen readers. */
  label: string;
  className?: string;
}) {
  const styles = tabStyles[variant];
  return (
    <nav
      aria-label={label}
      className={classNames(
        styles.list,
        "max-w-full overflow-x-auto",
        className,
      )}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          scroll={false}
          aria-current={tab.current ? "page" : undefined}
          className={classNames(
            "inline-flex shrink-0 items-center whitespace-nowrap transition-colors duration-(--duration-fast)",
            styles.tab,
            tab.current ? styles.active : styles.idle,
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
