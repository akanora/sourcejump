"use client";
// Restores what an invalidation took that's still out: one run, or a player's or key's runs.
import { RotateCcw } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { useStaffAction } from "../useStaffAction";

export function RestoreInvalidation({
  target,
  runs,
}: {
  target: { run: number } | { invalidation: number };
  /** How many runs it would restore. */
  runs: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = useStaffAction();
  const formId = useId();
  const count = `${runs.toLocaleString("en")} ${runs === 1 ? "run" : "runs"}`;

  async function restore(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(
      () =>
        "run" in target
          ? api.POST("/v1/staff/runs/{id}/restore", {
              params: { path: { id: target.run } },
              body: { reason },
            })
          : api.POST("/v1/staff/invalidations/{id}/restore", {
              params: { path: { id: target.invalidation } },
              body: { reason },
            }),
      "The runs couldn't be restored. Try again.",
    );
    if (done) {
      setOpen(false);
      setReason("");
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden />
        Restore {count}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          action.clearError();
        }}
        title={`Restore ${count}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={action.busy}
            >
              {action.busy ? "Restoring…" : `Restore ${count}`}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={restore} className="flex flex-col gap-3">
          <p className="text-text-muted">
            {"run" in target
              ? "The run goes back on the leaderboards and WR history."
              : "The runs this took that are still invalidated go back on the leaderboards and WR history. Runs restored or invalidated separately since stay as they are."}
          </p>
          <label className="flex flex-col gap-1.5 text-sm">
            Reason, for the staff log
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              required
              data-autofocus
            />
          </label>
          {action.error && (
            <p className="text-danger text-sm">{action.error}</p>
          )}
        </form>
      </Dialog>
    </>
  );
}
