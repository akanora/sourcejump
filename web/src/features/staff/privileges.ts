// What each privilege is called on the staff pages. The API sends privileges by their stable names.
import type { Schemas } from "@/api/client";

export const privilegeLabels: Record<Schemas["Privilege"], string> = {
  manage_privileges: "Privileges",
  manage_keys: "API keys",
  manage_servers: "Servers",
  manage_zones: "Zones",
  manage_maps: "Maps and tiers",
  manage_bans: "Bans",
  invalidate_runs: "Run invalidation",
  review_anticheat: "Anti-cheat",
  manage_posts: "Community posts",
  post_community: "Posting",
};

/** Reads a privilege list out of a log entry's detail, skipping anything that isn't a privilege name. */
export function privilegesIn(value: unknown): Schemas["Privilege"][] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (name): name is Schemas["Privilege"] =>
      typeof name === "string" && name in privilegeLabels,
  );
}
