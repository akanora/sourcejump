"use client";
// Lifts a ban after asking why. The runs it invalidated stay out until restored on the player's Manage view.
import { type FormEvent, useId, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { useStaffAction } from "../useStaffAction";

export function LiftBan({
  banId,
  playerName,
}: {
  banId: number;
  playerName: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = useStaffAction();
  const formId = useId();

  async function lift(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(
      () =>
        api.POST("/v1/staff/bans/{id}/lift", {
          params: { path: { id: banId } },
          body: { reason },
        }),
      "The ban couldn't be lifted. Try again.",
    );
    if (done) {
      setOpen(false);
      setReason("");
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Lift
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          action.clearError();
        }}
        title={`Lift ${playerName}'s ban?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={action.busy}
            >
              {action.busy ? "Lifting…" : "Lift ban"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={lift} className="flex flex-col gap-3">
          <p className="text-text-muted">
            The restrictions end now. Runs the ban invalidated stay off the
            boards; restore them on their Manage view if they should come back.
          </p>
          <label className="flex flex-col gap-1.5 text-sm">
            Reason, for staff only
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
