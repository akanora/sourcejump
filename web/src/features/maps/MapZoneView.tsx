"use client";
// A map's zones from above, and on asking, in 3D. The plan is drawn from the zones alone; the map itself
// downloads only once someone asks for the 3D view.
import { Box } from "lucide-react";
import { useState } from "react";
import type { Schemas } from "@/api/client";
import { ZoneEditor } from "@/features/staff/maps/ZoneEditor";
import { ZonePlan } from "@/features/staff/maps/ZonePlan";
import { Button } from "@/ui/Button";

export function MapZoneView({
  map,
  zones,
  viewerFile,
  tracks,
}: {
  map: string;
  zones: Schemas["Zone"][];
  /** Null when the map has no file for the 3D view yet; the plan still shows. */
  viewerFile: Schemas["ViewerFile"] | null;
  tracks: number[];
}) {
  const [in3d, setIn3d] = useState(false);
  if (in3d && viewerFile) {
    return (
      <ZoneEditor
        map={map}
        zones={zones}
        edit={null}
        viewerFile={viewerFile}
        tracks={tracks}
      />
    );
  }
  return (
    <>
      <ZonePlan zones={zones} />
      {viewerFile && (
        <Button className="self-start" onClick={() => setIn3d(true)}>
          <Box aria-hidden />
          View in 3D
        </Button>
      )}
    </>
  );
}
