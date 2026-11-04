"use client";
// Rates one of a map's tracks: picking a tier saves it at once. Earlier ratings are in the map's staff log.
import { api, type Schemas } from "@/api/client";
import { trackName } from "@/features/runs/time";
import { Segmented } from "@/ui/Segmented";
import { useStaffAction } from "../useStaffAction";

export function TierPicker({
  map,
  track,
  tierCount,
}: {
  map: string;
  track: Schemas["StaffTrack"];
  tierCount: number;
}) {
  const action = useStaffAction();

  function pick(value: string) {
    void action.run(
      () =>
        api.PUT("/v1/staff/maps/{map}/tiers/{track}", {
          params: { path: { map, track: track.track } },
          body: { tier: Number(value) },
        }),
      "The tier couldn't be saved. Try again.",
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Segmented
        label={`Tier of ${trackName(track.track)}`}
        value={track.tier != null ? String(track.tier) : ""}
        onChange={pick}
        options={Array.from({ length: tierCount }, (_, i) => ({
          value: String(i + 1),
          label: String(i + 1),
        }))}
      />
      {action.error && <p className="text-danger text-sm">{action.error}</p>}
    </div>
  );
}
