// One server on the Servers page: its country's flag, map, hostname, address, players and a Join link. Staff
// rows add badges and tools, and show unlisted servers dimmed with a dashed edge.
import type { ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { MapImage } from "@/features/maps/MapImage";
import { formatAgo } from "@/features/runs/time";
import { Badge } from "@/ui/Badge";
import { buttonClasses } from "@/ui/Button";
import { classNames } from "@/ui/classNames";
import { Flag } from "@/ui/Flag";
import { Link } from "@/ui/Link";
import { ServerAddress } from "./ServerAddress";

export function ServerRow({
  server,
  unlisted = false,
  badges,
  tools,
}: {
  server: Schemas["ListedServer"];
  /** Shown to staff only: the public list never has unlisted servers. */
  unlisted?: boolean;
  badges?: ReactNode;
  /** Staff controls after Join, kept at full strength when the row is dimmed. */
  tools?: ReactNode;
}) {
  const address = `${server.ip}:${server.port}`;
  // Each part is dimmed on its own, not inside one wrapper, so the row still wraps as one flex line on phones.
  const dim = classNames(
    "transition-opacity duration-(--duration-base)",
    unlisted ? "opacity-50" : !server.online && "opacity-60",
  );
  return (
    <ServerRowFrame unlisted={unlisted}>
      <MapImage image={server.map_image} size="thumbnail" className={dim} />
      <span className={classNames("flex min-w-0 flex-1 flex-col gap-1", dim)}>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap">
          {/* Only a known country: Flag's placeholder speaks of Steam, which a server has nothing to do with. */}
          {server.country_code && <Flag code={server.country_code} />}
          <span className="font-bold break-words sm:truncate">
            {server.hostname}
          </span>
          {server.connected && (
            <Badge
              tone="accent"
              title="Runs on this server count on SourceJump"
            >
              Connected
            </Badge>
          )}
          {badges}
        </span>
        <span className="text-text-muted flex flex-wrap items-center gap-x-3 text-sm">
          {server.map_has_page ? (
            <Link href={`/maps/${server.map}`} className="hover:text-accent">
              {server.map}
            </Link>
          ) : (
            <span>{server.map}</span>
          )}
          <ServerAddress address={address} />
        </span>
      </span>
      {/* With staff tools there's no room beside the name on a phone, so they take a line of their own. */}
      <span
        className={classNames(
          "flex items-center gap-4",
          tools != null && "w-full justify-end sm:w-auto",
        )}
      >
        <span className={classNames("flex items-center gap-4", dim)}>
          {server.online ? (
            <span className="flex items-center gap-2 text-sm tabular-nums">
              <span aria-hidden className="bg-success size-2 rounded-full" />
              <span>
                <span className="font-bold">{server.players}</span>
                <span className="text-text-muted">/{server.max_slots}</span>
              </span>
            </span>
          ) : (
            <span className="text-text-muted text-sm">
              Last seen{" "}
              <time dateTime={server.last_seen_at}>
                {formatAgo(server.seen_minutes_ago)}
              </time>
            </span>
          )}
          {server.online && (
            <a
              href={`steam://connect/${address}`}
              className={buttonClasses({ size: "sm" })}
            >
              Join
            </a>
          )}
        </span>
        {tools && <span className="flex items-center gap-1">{tools}</span>}
      </span>
    </ServerRowFrame>
  );
}

/** The row's box, shared with the staff-only row of a server listed before it was ever heard from. */
export function ServerRowFrame({
  unlisted = false,
  children,
}: {
  unlisted?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={classNames(
        "border-border bg-surface flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3 sm:flex-nowrap",
        unlisted && "border-dashed",
      )}
    >
      {children}
    </div>
  );
}
