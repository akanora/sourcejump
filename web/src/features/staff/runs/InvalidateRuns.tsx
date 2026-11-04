"use client";
// Invalidates every valid run of a player, from their Manage view: staff see how many runs that is and give a
// reason. A server's runs are invalidated by revoking its key, on the API keys page.
import { Ban } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { api, failureMessage, type Schemas } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { useStaffAction } from "../useStaffAction";

type Preview =
  | { target: string; preview: Schemas["InvalidationPreview"] }
  | { target: string; error: string };

export function InvalidateRuns({ player }: { player: Schemas["PlayerRef"] }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const action = useStaffAction();
  const formId = useId();
  const { steamid64 } = player;

  // Counts the runs once the dialog opens.
  useEffect(() => {
    if (!open) return;
    let current = true;
    void api
      .GET("/v1/staff/invalidations/preview", {
        params: { query: { player: steamid64 } },
      })
      .then((result) => {
        if (!current) return;
        setPreview(
          result.data
            ? { target: steamid64, preview: result.data }
            : {
                target: steamid64,
                error: failureMessage(
                  result.error,
                  "That couldn't be looked up.",
                ),
              },
        );
      })
      .catch(() => {
        if (current) {
          setPreview({
            target: steamid64,
            error: "That couldn't be looked up.",
          });
        }
      });
    return () => {
      current = false;
    };
  }, [open, steamid64]);

  const shown = preview?.target === steamid64 ? preview : undefined;
  const counted = shown && "preview" in shown ? shown.preview : undefined;
  const runs = counted?.valid_runs ?? 0;

  function close() {
    setOpen(false);
    setReason("");
    setPreview(undefined);
    action.clearError();
  }

  async function invalidate(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(
      () =>
        api.POST("/v1/staff/invalidations", {
          body: { player: steamid64, reason },
        }),
      "The runs couldn't be invalidated. Try again.",
    );
    if (done) close();
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Ban aria-hidden />
        Invalidate their runs
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={`Invalidate ${player.name}'s runs`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={formId}
              disabled={action.busy || runs === 0}
            >
              {action.busy
                ? "Invalidating…"
                : runs > 0
                  ? `Invalidate ${runs.toLocaleString("en")} ${runs === 1 ? "run" : "runs"}`
                  : "Invalidate"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={invalidate} className="flex flex-col gap-3">
          <p className="text-text-muted min-h-5 text-sm" aria-live="polite">
            {!shown ? (
              "Counting their runs…"
            ) : "error" in shown ? (
              <span className="text-danger">{shown.error}</span>
            ) : (
              <Summary preview={shown.preview} />
            )}
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
          <p className="text-text-muted text-sm">
            The runs leave the leaderboards and WR history, and their pages say
            they were invalidated. They can be restored on their Manage view.
          </p>
          {action.error && (
            <p className="text-danger text-sm">{action.error}</p>
          )}
        </form>
      </Dialog>
    </>
  );
}

function Summary({ preview }: { preview: Schemas["InvalidationPreview"] }) {
  const whose = preview.player?.name;
  const valid = preview.valid_runs.toLocaleString("en");
  const already = preview.invalidated_runs;
  return (
    <>
      <span className="text-text">{whose}</span>: {valid} valid{" "}
      {preview.valid_runs === 1 ? "run" : "runs"}
      {already > 0 && `, ${already.toLocaleString("en")} already invalidated`}
    </>
  );
}
