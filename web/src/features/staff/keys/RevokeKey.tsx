"use client";
// Revokes a server's key after asking why. The server can't submit from then on; staff who may invalidate runs
// can take every run it sent off the boards too.
import { Ban } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { useStaffAction } from "../useStaffAction";

export function RevokeKey({
  prefix,
  serverName,
  validRuns,
}: {
  prefix: string;
  serverName: string;
  /** Runs the server sent, with any key, that are still valid; 0 when the staff member can't invalidate runs,
   * hiding the option. */
  validRuns: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [invalidateRuns, setInvalidateRuns] = useState(false);
  const action = useStaffAction();
  const formId = `revoke-${prefix}`;

  async function revoke(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(
      () =>
        api.POST("/v1/staff/keys/{prefix}/revoke", {
          params: { path: { prefix } },
          body: { reason, invalidate_runs: validRuns > 0 && invalidateRuns },
        }),
      "The key couldn't be revoked. Try again.",
    );
    if (done) {
      setOpen(false);
      setReason("");
      setInvalidateRuns(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Ban aria-hidden />
        Revoke
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          action.clearError();
        }}
        title={`Revoke the key of ${serverName}`}
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
              {action.busy ? "Revoking…" : "Revoke key"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={revoke} className="flex flex-col gap-3">
          <p className="text-text-muted">
            {serverName} can&apos;t submit runs or detections from now on, until
            it&apos;s issued a new key.
            {(validRuns === 0 || !invalidateRuns) &&
              " The runs it already sent stay as they are."}
          </p>
          {validRuns > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={invalidateRuns}
                onChange={(event) => setInvalidateRuns(event.target.checked)}
                className="accent-accent size-4"
              />
              Also invalidate the {validRuns.toLocaleString("en")} valid{" "}
              {validRuns === 1 ? "run" : "runs"} the server sent
            </label>
          )}
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
