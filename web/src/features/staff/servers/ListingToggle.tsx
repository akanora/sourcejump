"use client";
// The eye on a staff member's server row: puts the server on the site's server list, or takes it off.
import { Eye, EyeOff } from "lucide-react";
import { api } from "@/api/client";
import { Button } from "@/ui/Button";
import { Tooltip } from "@/ui/Tooltip";
import { useStaffAction } from "../useStaffAction";

export function ListingToggle({
  address,
  listed,
  onChanged,
}: {
  address: string;
  listed: boolean;
  onChanged: () => void;
}) {
  const action = useStaffAction();
  const params = { params: { path: { address } } };
  const label = listed ? "Unlist this server" : "List this server";

  async function toggle() {
    const done = await action.run(
      () =>
        listed
          ? api.DELETE("/v1/staff/listings/{address}", params)
          : api.PUT("/v1/staff/listings/{address}", params),
      listed
        ? "The server couldn't be unlisted. Try again."
        : "The server couldn't be listed. Try again.",
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
          {listed ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
        </Button>
      </Tooltip>
    </>
  );
}
