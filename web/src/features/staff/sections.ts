// The staff area's sections and who sees them. The API enforces every privilege; this only decides what to show.
import { KeyRound, type LucideIcon, ScrollText } from "lucide-react";
import type { Schemas } from "@/api/client";

type Privilege = Schemas["Privilege"];

export type StaffSection = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any one of these opens the section; null for every staff member. */
  privileges: Privilege[] | null;
};

/** In sidebar order. */
export const staffSections: StaffSection[] = [
  {
    href: "/staff",
    label: "Logs",
    icon: ScrollText,
    privileges: null,
  },
  {
    href: "/staff/keys",
    label: "API keys",
    icon: KeyRound,
    privileges: ["manage_keys"],
  },
];

/** Any privilege but posting makes a player staff, as in the API's `Privilege::is_staff`. */
export function isStaff(privileges: readonly Privilege[]): boolean {
  return privileges.some((privilege) => privilege !== "post_community");
}

export function sectionsFor(privileges: readonly Privilege[]): StaffSection[] {
  if (!isStaff(privileges)) return [];
  return staffSections.filter(
    (section) =>
      section.privileges === null ||
      section.privileges.some((p) => privileges.includes(p)),
  );
}

/** Logs, at the area's root, is current only on its own page; other sections also on the pages below them. */
export function isCurrentSection(href: string, pathname: string): boolean {
  return href === "/staff"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}
