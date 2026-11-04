"use client";
// Puts a post staff removed back on the Community page, after asking why.
import { RotateCcw } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { useStaffAction } from "../useStaffAction";

export function RestorePost({
  id,
  title,
  onRestored,
}: {
  id: number;
  title: string;
  /** After restoring, for a caller that holds the post itself rather than reading it from the page. */
  onRestored?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = useStaffAction();
  const formId = useId();

  function close() {
    setOpen(false);
    action.clearError();
  }

  async function restore(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(
      () =>
        api.POST("/v1/staff/posts/{id}/restore", {
          params: { path: { id: String(id) } },
          body: { reason },
        }),
      "The post couldn't be restored. Try again.",
    );
    if (done) {
      setOpen(false);
      setReason("");
      onRestored?.();
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden />
        Restore
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Restore this post?"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={action.busy}
            >
              {action.busy ? "Restoring…" : "Restore"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={restore} className="flex flex-col gap-3">
          <p className="text-text-muted">
            &ldquo;{title}&rdquo; will show on the Community page again.
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
