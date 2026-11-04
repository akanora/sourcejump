"use client";
// LinkTabs whose current tab follows the address, for tabs in a layout that stays while the page under it
// changes, such as a map's Map and Manage views.
import { usePathname } from "next/navigation";
import { LinkTabs } from "./LinkTabs";
import type { TabVariant } from "./tabStyles";

export function PathTabs({
  tabs,
  label,
  variant,
  className,
}: {
  tabs: { href: string; label: string }[];
  /** Names the group for screen readers. */
  label: string;
  variant?: TabVariant;
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <LinkTabs
      label={label}
      variant={variant}
      className={className}
      tabs={tabs.map((tab) => ({ ...tab, current: tab.href === pathname }))}
    />
  );
}
