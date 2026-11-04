"use client";
// Removes a post after asking first. The API hides it rather than deleting it. Staff removing someone else's
// post give a reason, which the staff log keeps; staff still see the post, and can restore it, on its page.
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { api, failureMessage } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";

export function RemovePost({
  id,
  title,
  asStaff,
  onRemoved,
}: {
  id: number;
  title: string;
  /** Someone else's post, removed with `manage_posts`. */
  asStaff: boolean;
  /** After staff remove it, for a caller that holds the post itself. */
  onRemoved?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await (
      asStaff
        ? api.POST("/v1/staff/posts/{id}/hide", {
            params: { path: { id: String(id) } },
            body: { reason },
          })
        : api.DELETE("/v1/posts/{post}", {
            params: { path: { post: String(id) } },
          })
    ).catch(() => undefined);
    setBusy(false);
    if (result?.response.ok) {
      // Staff stay on the page, which now shows the post as removed, with Restore; an author leaves it.
      if (!asStaff) router.push("/community");
      router.refresh();
      setOpen(false);
      onRemoved?.();
    } else {
      setError(
        failureMessage(
          result?.error,
          "The post couldn't be removed. Try again.",
        ),
      );
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        Remove
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Remove this post?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={busy}
            >
              {busy ? "Removing…" : "Remove"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={remove} className="flex flex-col gap-3">
          <p className="text-text-muted">
            &ldquo;{title}&rdquo; will no longer show on the site.
            {asStaff && " Staff can still see it here and restore it."}
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
