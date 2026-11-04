// One ban: what it restricts, until when, who decided it and why, and how it ended.
import type { Schemas } from "@/api/client";
import { formatDate } from "@/features/runs/time";
import { Badge } from "@/ui/Badge";
import { Link } from "@/ui/Link";
import { LiftBan } from "./LiftBan";
import { restrictionList } from "./restrictions";

export function BanItem({
  ban,
  showPlayer = false,
}: {
  ban: Schemas["Ban"];
  /** For lists of many players' bans. */
  showPlayer?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          {showPlayer && (
            <Link
              href={`/players/${ban.player.steamid64}/manage`}
              className="hover:text-accent font-bold"
            >
              {ban.player.name}
            </Link>
          )}
          <span>{restrictionList(ban.restrictions)}</span>
          {ban.active ? (
            <Badge tone="danger">Active</Badge>
          ) : (
            <Badge>{ban.lifted_at ? "Lifted" : "Ended"}</Badge>
          )}
        </p>
        <p className="text-text-muted text-sm">
          {ban.reason} · {ban.banned_by?.name ?? "Command line"},{" "}
          {formatDate(ban.banned_at)} ·{" "}
          {ban.lifted_at
            ? `lifted ${formatDate(ban.lifted_at)} by ${ban.lifted_by?.name ?? "the command line"}: ${ban.lift_reason ?? ""}`
            : ban.ends_at
              ? `${ban.active ? "ends" : "ended"} ${formatDate(ban.ends_at)}`
              : "until lifted"}
        </p>
      </div>
      {ban.active && <LiftBan banId={ban.id} playerName={ban.player.name} />}
    </li>
  );
}
