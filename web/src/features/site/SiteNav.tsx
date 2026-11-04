"use client";
// Header navigation: section links on wide screens, a menu on narrow ones. Marks the current section.
import { Menu as MenuIcon } from "lucide-react";
import { Link } from "@/ui/Link";
import { usePathname } from "next/navigation";
import { classNames } from "@/ui/classNames";
import { Menu, MenuLink } from "@/ui/Menu";
import { isCurrent, sections } from "./navigation";

/**
 * On pages with a dynamic address, such as a profile, the path is only known per request. SiteHeader shows
 * `SiteNavLinks` without a current section while it streams in, so every page's shell stays static.
 */
export function SiteNav() {
  return <SiteNavLinks pathname={usePathname()} />;
}

export function SiteNavLinks({ pathname }: { pathname: string | null }) {
  return (
    <>
      <nav aria-label="Main" className="hidden h-full lg:block">
        <ul className="flex h-full items-stretch gap-6">
          {sections.map(({ href, label }) => {
            const current = isCurrent(href, pathname);
            return (
              <li key={href} className="flex">
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={classNames(
                    "flex items-center border-b-2 pt-0.5 text-sm transition-colors duration-(--duration-fast)",
                    current
                      ? "border-accent text-accent"
                      : "text-text-muted hover:text-text border-transparent",
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* Ordered before the wordmark, so on a phone the menu button sits on its left. */}
      <div className="-order-1 -ml-2 lg:hidden">
        <Menu
          label="Sections"
          trigger={<MenuIcon aria-hidden className="size-5" />}
          triggerClassName="flex size-10 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text"
        >
          {sections.map(({ href, label }) => (
            <MenuLink
              key={href}
              href={href}
              aria-current={isCurrent(href, pathname) ? "page" : undefined}
              className="aria-[current=page]:text-accent"
            >
              {label}
            </MenuLink>
          ))}
        </Menu>
      </div>
    </>
  );
}
