// The site's main sections, shown in the header. Each section's page arrives with its roadmap slice. Community
// posts (`/community`) are left out of the header for now (lead, 2026-10-28); the pages and API remain.
export const sections = [
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/maps", label: "Maps" },
  { href: "/players", label: "Players" },
  { href: "/activity", label: "Activity" },
  { href: "/servers", label: "Servers" },
] as const;

/** A section is current on its own page and on every page below it. */
export function isCurrent(href: string, pathname: string | null): boolean {
  if (pathname === null) return false;
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}
