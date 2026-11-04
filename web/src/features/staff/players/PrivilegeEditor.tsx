"use client";
// A player's privileges as a checklist: tick and untick, review the change, give a reason, save. Nobody changes
// their own, and manage_privileges is changed only with the server's command line (lead, 2026-10-20).
import { type FormEvent, useId, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { DividedSection } from "@/ui/Divided";
import { Input } from "@/ui/Input";
import { privilegeLabels } from "../privileges";
import { useStaffAction } from "../useStaffAction";

type Privilege = Schemas["Privilege"];
const PRIVILEGES = Object.keys(privilegeLabels) as Privilege[];
const CLI_ONLY: Privilege = "manage_privileges";

export function PrivilegeEditor({
  player,
  held,
  own,
}: {
  player: Schemas["PlayerRef"];
  held: Privilege[];
  /** The signed-in staff member's own page: shown, not changeable. */
  own: boolean;
}) {
  const [chosen, setChosen] = useState<Privilege[]>(held);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = useStaffAction();
  const formId = useId();
  const grant = chosen.filter((p) => !held.includes(p));
  const revoke = held.filter((p) => !chosen.includes(p));
  const changed = grant.length + revoke.length > 0;

  function toggle(privilege: Privilege, on: boolean) {
    setChosen((current) =>
      on
        ? PRIVILEGES.filter((p) => p === privilege || current.includes(p))
        : current.filter((p) => p !== privilege),
    );
  }

  function close() {
    setOpen(false);
    action.clearError();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(
      () =>
        api.POST("/v1/staff/players/{player}/privileges", {
          params: { path: { player: player.steamid64 } },
          body: { grant, revoke, reason },
        }),
      "The privileges couldn't be saved. Try again.",
    );
    if (done) {
      setOpen(false);
      setReason("");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {PRIVILEGES.map((privilege) => {
          const fixed = own || privilege === CLI_ONLY;
          return (
            <li key={privilege}>
              <label
                className={`flex items-center gap-2 ${fixed ? "text-text-muted" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(privilege)}
                  disabled={fixed}
                  onChange={(event) => toggle(privilege, event.target.checked)}
                  className="accent-accent size-4"
                />
                {privilegeLabels[privilege]}
                {privilege === CLI_ONLY && !own && (
                  <span className="text-text-muted">
                    · server command line only
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {own ? (
        <p className="text-text-muted text-sm">
          You can&apos;t change your own privileges.
        </p>
      ) : (
        changed && (
          <DividedSection className="flex flex-wrap items-center gap-3">
            <p className="text-text-muted flex-1 text-sm">
              <ChangeSummary grant={grant} revoke={revoke} />
            </p>
            <Button size="sm" variant="ghost" onClick={() => setChosen(held)}>
              Undo
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              Review and save
            </Button>
          </DividedSection>
        )
      )}
      <Dialog
        open={open}
        onClose={close}
        title={`Change ${player.name}'s privileges`}
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
              {action.busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={save} className="flex flex-col gap-3">
          {grant.length > 0 && (
            <p>
              <span className="text-text-muted">Grant:</span> {names(grant)}
            </p>
          )}
          {revoke.length > 0 && (
            <p>
              <span className="text-text-muted">Revoke:</span> {names(revoke)}
            </p>
          )}
          <p className="text-text-muted text-sm">
            It applies at once and is recorded in the staff log.
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
    </div>
  );
}

function ChangeSummary({
  grant,
  revoke,
}: {
  grant: Privilege[];
  revoke: Privilege[];
}) {
  return (
    <>
      {grant.length > 0 && <>Grant {names(grant)}</>}
      {grant.length > 0 && revoke.length > 0 && " · "}
      {revoke.length > 0 && <>Revoke {names(revoke)}</>}
    </>
  );
}

function names(privileges: Privilege[]): string {
  return privileges.map((p) => privilegeLabels[p]).join(", ");
}
