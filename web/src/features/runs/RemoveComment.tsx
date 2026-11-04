"use client";
// Removes a comment after asking first. The API hides it rather than deleting it. Staff removing someone
// else's comment give a reason, which the staff log keeps; staff still see it in place, and can restore it.
import { Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { api, failureMessage } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";

export function RemoveComment({
  run,
  id,
  asStaff,
  onRemoved,
}: {
  run: number;
  id: number;
  /** Someone else's comment, removed with `manage_posts`. */
  asStaff: boolean;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  async function remove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await (
      asStaff
        ? api.POST("/v1/staff/run-comments/{id}/hide", {
            params: { path: { id } },
            body: { reason },
          })
        : api.DELETE("/v1/runs/{id}/comments/{comment}", {
            params: { path: { id: run, comment: id } },
          })
    ).catch(() => undefined);
    setBusy(false);
    if (result?.response.ok) {
      setOpen(false);
      setReason("");
      onRemoved();
    } else {
      setError(
        failureMessage(
          result?.error,
          "The comment couldn't be removed. Try again.",
        ),
      );
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        {asStaff ? "Remove" : "Delete"}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={asStaff ? "Remove this comment?" : "Delete your comment?"}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Keep it
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={busy}
            >
              {busy ? "Removing…" : asStaff ? "Remove" : "Delete"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={remove} className="flex flex-col gap-3">
          <p className="text-text-muted">
            {asStaff
              ? "It will no longer show on this run's page. Staff can still see it here and restore it."
              : "It will no longer show on this run's page."}
          </p>
          {asStaff && (
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
          )}
          {error && <p className="text-danger text-sm">{error}</p>}
        </form>
      </Dialog>
    </>
  );
}
