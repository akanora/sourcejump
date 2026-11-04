"use client";
// The info button on a staff member's server row, and the dialog it opens: what the server last reported
// beyond the public row (rules check, versions, plugins, key) and who listed it. SourceJump never contacts a
// game server, so all of it is the server's own word.
import { Info } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Schemas } from "@/api/client";
import { formatDate, formatDateTime } from "@/features/runs/time";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { DividedList } from "@/ui/Divided";
import { Tooltip } from "@/ui/Tooltip";

export function ServerDetails({
  server,
  report,
  listing,
}: {
  server: Schemas["ListedServer"];
  report: Schemas["ServerReport"];
  listing: Schemas["ServerListing"] | null | undefined;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip content="Server details">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Server details"
          onClick={() => setOpen(true)}
          className="px-2"
        >
          <Info aria-hidden />
        </Button>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={server.hostname}
      >
        <DividedList as="dl" className="-my-2 text-sm">
          <Row term="Rules">
            <span className="flex items-center justify-end gap-2">
              {report.ruleset_version == null
                ? "No ruleset"
                : `Ruleset v${report.ruleset_version}`}
              {report.compliant ? (
                <Badge tone="success">Compliant</Badge>
              ) : (
                <Badge tone="warning">Not compliant</Badge>
              )}
            </span>
            {report.problems.length > 0 && (
              <ul className="text-warning mt-1 flex flex-col gap-0.5">
                {report.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </Row>
          <Row term="SourceJump plugin">{report.plugin_version}</Row>
          <Row term="shavit">{report.shavit_version || "Not found"}</Row>
          <Row term="SourceMod">{report.sourcemod_version}</Row>
          <Row term="Key">
            {report.key_server ? report.key_server.name : "No key"}
          </Row>
          {report.reported_ip && (
            <Row term="Reported IP">
              <span className="text-warning">
                Says it&apos;s {report.reported_ip}; its heartbeats come from{" "}
                {server.ip}
              </span>
            </Row>
          )}
          <Row term="Listed">
            {listing
              ? `${formatDate(listing.listed_at)}, ${
                  listing.listed_by
                    ? `by ${listing.listed_by.name}`
                    : "from the command line"
                }`
              : "No"}
          </Row>
          <Row term="Last heartbeat">{formatDateTime(server.last_seen_at)}</Row>
          <div className="flex flex-col gap-2 py-2">
            <dt className="text-text-muted">
              Plugins · {report.plugins.length}
            </dt>
            <dd>
              {report.plugins.length === 0 && (
                <span className="text-text-muted">None reported.</span>
              )}
              <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
                {report.plugins.map((plugin) => (
                  <li
                    key={`${plugin.name}-${plugin.file_hash}`}
                    className="flex justify-between gap-3"
                  >
                    <span className="truncate">{plugin.name}</span>
                    <span className="text-text-subtle tabular-nums">
                      {plugin.version}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </DividedList>
      </Dialog>
    </>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-2">
      <dt className="text-text-muted shrink-0">{term}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}
