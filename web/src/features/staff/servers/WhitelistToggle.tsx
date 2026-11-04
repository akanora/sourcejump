"use client";
// The lock on a staff member's listed server row: marks the server as a whitelist server, or as public.
import { Lock, LockOpen } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/ui/Button";
import { Tooltip } from "@/ui/Tooltip";
import { useStaffAction } from "../useStaffAction";

export function WhitelistToggle({
  address,
  whitelist,
  onChanged,
}: {
  address: string;
  whitelist: boolean;
  onChanged: () => void;
}) {
  const action = useStaffAction();
  const params = { params: { path: { address } } };
  const label = whitelist ? "Mark as public" : "Mark as whitelist server";

  async function toggle() {
    const done = await action.run(
      () =>
        whitelist
          ? api.DELETE("/v1/staff/listings/{address}/whitelist", params)
          : api.PUT("/v1/staff/listings/{address}/whitelist", params),
      whitelist
        ? "The server couldn't be marked as public. Try again."
        : "The server couldn't be marked as a whitelist server. Try again.",
    );
    if (done) onChanged();
  }

  return (
    <>
      {action.error && (
        <span role="alert" className="text-danger text-xs">
          {action.error}
        </span>
      )}
      <Tooltip content={label}>
        <Button
          size="sm"
          variant="ghost"
          aria-label={label}
          onClick={toggle}
          disabled={action.busy}
          className="px-2"
        >
          {whitelist ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
        </Button>
      </Tooltip>
    </>
  );
}
