"use client";
// The staff area's sections: a sidebar on wide screens, a menu on narrow ones. Marks the current section.
import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import type { Schemas } from "@/api/client";
import { classNames } from "@/ui/classNames";
import { Link } from "@/ui/Link";
import { Menu, MenuLink } from "@/ui/Menu";
import { isCurrentSection, sectionsFor } from "./sections";

/** Takes privileges rather than sections: icons are components, which can't be sent from the server. */
export function StaffNav({
  privileges,
}: {
  privileges: Schemas["Privilege"][];
}) {
  const pathname = usePathname();
  const sections = sectionsFor(privileges);
  const current = sections.find((s) => isCurrentSection(s.href, pathname));

  return (
    <>
      <nav aria-label="Staff" className="hidden w-48 shrink-0 lg:block">
        <ul className="flex flex-col gap-1">
          {sections.map(({ href, label, icon: Icon }) => {
            const isCurrent = current?.href === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isCurrent ? "page" : undefined}
                  className={classNames(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-(--duration-fast)",
                    isCurrent
                      ? "bg-accent-soft text-accent"
                      : "text-text-muted hover:bg-surface-raised hover:text-text",
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="lg:hidden">
        <Menu
          label="Staff sections"
          trigger={
            <>
              {current?.label ?? "Staff"}
              <ChevronDown aria-hidden className="size-4" />
            </>
          }
          triggerClassName="border-border-strong text-text hover:bg-surface-raised flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
        >
          {sections.map(({ href, label, icon: Icon }) => (
            <MenuLink
              key={href}
              href={href}
              aria-current={current?.href === href ? "page" : undefined}
              className="aria-[current=page]:text-accent"
            >
              <Icon aria-hidden />
              {label}
            </MenuLink>
          ))}
        </Menu>
      </div>
    </>
  );
}
