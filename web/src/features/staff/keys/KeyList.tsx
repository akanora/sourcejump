// Every server SourceJump issued a key to, one row each: its current key, its runs and when it was last heard,
// with Restore for the invalidations of its runs that still hold some out.
import { api, type Schemas } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { formatDate, formatDateTime, formatSince } from "@/features/runs/time";
import { Card } from "@/ui/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/ui/Table";
import { Tooltip } from "@/ui/Tooltip";
import { ReadFailure } from "../ReadFailure";
import { RestoreInvalidation } from "../runs/RestoreInvalidation";
import { readAsStaff } from "../staffApi";
import { IssueKey } from "./IssueKey";
import { RevokeKey } from "./RevokeKey";

type Server = Schemas["KeyedServer"];

export async function KeyList() {
  const [result, me] = await Promise.all([
    readAsStaff((headers) => api.GET("/v1/staff/keys", { headers })),
    signedInPlayer(),
  ]);
  if (!("data" in result)) return <ReadFailure failure={result} />;
  const { servers } = result.data;
  const mayInvalidate = me?.privileges.includes("invalidate_runs") ?? false;
  // Only servers with invalidated runs can have an invalidation to restore; there are few of them.
  const restorable = new Map(
    mayInvalidate
      ? await Promise.all(
          servers
            .filter((server) => server.invalidated_runs > 0)
            .map(async (server) => {
              const result = await readAsStaff((headers) =>
                api.GET("/v1/staff/invalidations", {
                  params: { query: { server: server.id } },
                  headers,
                }),
              );
              const holding =
                "data" in result
                  ? result.data.invalidations.filter((i) => i.still_invalid > 0)
                  : [];
              return [server.id, holding] as const;
            }),
        )
      : [],
  );

  if (servers.length === 0) {
    return (
      <Card className="text-text-muted">
        No server has a key yet. Issue one when a server owner asks for it.
      </Card>
    );
  }
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Server</TableHeaderCell>
          <TableHeaderCell>Key</TableHeaderCell>
          <TableHeaderCell numeric>Runs</TableHeaderCell>
          <TableHeaderCell>Last heard</TableHeaderCell>
          <TableHeaderCell>
            <span className="sr-only">Actions</span>
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {servers.map((server) => (
          <ServerRow
            key={server.id}
            server={server}
            mayInvalidate={mayInvalidate}
            restorable={restorable.get(server.id) ?? []}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function ServerRow({
  server,
  mayInvalidate,
  restorable,
}: {
  server: Server;
  mayInvalidate: boolean;
  /** Invalidations of this server's runs that still hold some out. */
  restorable: Schemas["InvalidationEntry"][];
}) {
  const { key, last_heartbeat: heard } = server;
  const validRuns = server.runs - server.invalidated_runs;
  return (
    <TableRow>
      <TableCell wrap className="py-2">
        <p className={key ? undefined : "text-text-muted"}>{server.name}</p>
        <p className="text-text-subtle text-xs tabular-nums">
          {heard ? heard.address : "Never heard from"}
        </p>
      </TableCell>
      <TableCell className="py-2">
        {key ? (
          <>
            <code className="text-text-muted tabular-nums">{key.prefix}…</code>
            <p className="text-text-subtle text-xs">
              Issued {formatDate(key.created_at)}
            </p>
          </>
        ) : (
          <>
            <p className="text-text-muted">No key</p>
            {server.revoked_at && (
              <p className="text-text-subtle text-xs">
                Revoked {formatDate(server.revoked_at)}
              </p>
            )}
          </>
        )}
      </TableCell>
      <TableCell numeric className="py-2">
        {server.runs.toLocaleString("en")}
        {server.invalidated_runs > 0 && (
          <p className="text-text-subtle text-xs">
            {server.invalidated_runs.toLocaleString("en")} invalidated
          </p>
        )}
        {restorable.map((entry) => (
          <RestoreInvalidation
            key={entry.id}
            target={{ invalidation: entry.id }}
            runs={entry.still_invalid}
          />
        ))}
      </TableCell>
      <TableCell className="text-text-muted py-2">
        {heard ? (
          <Tooltip content={formatDateTime(heard.received_at)}>
            <time
              dateTime={heard.received_at}
              tabIndex={0}
              className="rounded-sm"
            >
              {formatSince(heard.received_at)}
            </time>
          </Tooltip>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="py-2 text-right">
        {/* Wrapping keeps the table within the page when a row has several actions. */}
        <div className="flex flex-wrap justify-end gap-1">
          <IssueKey
            server={{ id: server.id, name: server.name, current: key?.prefix }}
          />
          {key && (
            <RevokeKey
              prefix={key.prefix}
              serverName={server.name}
              validRuns={mayInvalidate ? validRuns : 0}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
