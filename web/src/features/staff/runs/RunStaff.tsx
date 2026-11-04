"use client";
// The staff card under a run's details on its page: the staff log's entries about the run, and Invalidate or
// Restore for staff who hold invalidate_runs. It loads in the browser, so the page stays the same for
// everyone; the API checks every privilege again.
import { Ban, RotateCcw } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { api, type Schemas } from "@/api/client";
import { useSignedInPlayer } from "@/features/auth/useSignedInPlayer";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Input } from "@/ui/Input";
import { EntryList } from "../EntryList";
import { isStaff } from "../sections";
import { useStaffAction } from "../useStaffAction";

type Run = Pick<Schemas["RunDetail"], "id" | "invalidated">;

export function RunStaff({ run }: { run: Run }) {
  const me = useSignedInPlayer();
  const staff = me ? isStaff(me.privileges) : false;
  const [log, setLog] = useState<Schemas["LogEntries"] | null>();

  const reload = useCallback(() => {
    void api
      .GET("/v1/staff/runs/{id}/log", { params: { path: { id: run.id } } })
      .then((result) => setLog(result.data ?? null))
      .catch(() => setLog(null));
  }, [run.id]);

  useEffect(() => {
    if (staff) reload();
  }, [staff, reload]);

  if (!me || !staff || log === undefined) return null;
  const canChange = me.privileges.includes("invalidate_runs");

  return (
    <Card className="motion-enter flex flex-col gap-3">
      <RunValidity
        run={run}
        allowed={canChange}
        onChanged={reload}
        heading={<h2 className="font-bold">Staff log for this run</h2>}
      />
      {log === null ? (
        <p className="text-text-muted text-sm">
          The staff log couldn&apos;t be loaded. Try again in a moment.
        </p>
      ) : (
        <EntryList
          key={log.entries[0]?.id ?? 0}
          about={{ run: run.id }}
          first={log}
          empty="No staff action has been taken on this run."
        />
      )}
    </Card>
  );
}

/** The card's heading with Invalidate or Restore beside it; the button opens the reason form below them. */
function RunValidity({
  run,
  allowed,
  onChanged,
  heading,
}: {
  run: Run;
  allowed: boolean;
  onChanged: () => void;
  heading: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const action = useStaffAction();
  const restoring = run.invalidated;
  const label = restoring ? "Restore run" : "Invalidate run";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const params = { path: { id: run.id } };
    const done = await action.run(
      () =>
        restoring
          ? api.POST("/v1/staff/runs/{id}/restore", {
              params,
              body: { reason },
            })
          : api.POST("/v1/staff/runs/{id}/invalidate", {
              params,
              body: { reason },
            }),
      restoring
        ? "The run couldn't be restored. Try again."
        : "The run couldn't be invalidated. Try again.",
    );
    if (done) {
      setAsking(false);
      setReason("");
      onChanged();
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        {heading}
        {allowed && !asking && (
          <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
            {restoring ? <RotateCcw aria-hidden /> : <Ban aria-hidden />}
            {label}
          </Button>
        )}
      </div>
      {asking && (
        <form onSubmit={submit} className="motion-enter flex flex-col gap-3">
          <p className="text-text-muted text-sm">
            {restoring
              ? "It goes back on the leaderboards and WR history, and becomes the player's personal best again if it's their fastest."
              : "It leaves the leaderboards and WR history. If it's the player's personal best, their next fastest run takes its place. Its page will say it was invalidated."}
          </p>
          <label className="flex flex-col gap-1.5 text-sm">
            Reason, for the staff log
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              required
              autoFocus
            />
          </label>
          {action.error && (
            <p className="text-danger text-sm">{action.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setAsking(false);
                action.clearError();
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={action.busy}>
              {action.busy
                ? restoring
                  ? "Restoring…"
                  : "Invalidating…"
                : label}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
