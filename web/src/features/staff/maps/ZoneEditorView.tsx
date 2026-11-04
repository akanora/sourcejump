// Reads what the zone editor starts from, as staff: the zone set in force, the map's tracks and its file for
// the 3D view. Staff without manage_zones are told so rather than shown an editor the API would refuse.
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { Card } from "@/ui/Card";
import { Link } from "@/ui/Link";
import { ReadFailure } from "../ReadFailure";
import { getStaffMap } from "./staffMap";
import { ZoneEditor } from "./ZoneEditor";

export async function ZoneEditorView({ name }: { name: string }) {
  const [result, me] = await Promise.all([getStaffMap(name), signedInPlayer()]);
  if (!("data" in result)) return <ReadFailure failure={result} />;
  const map = result.data;

  if (!me?.privileges.includes("manage_zones")) {
    return (
      <Card className="text-sm">
        Editing zones needs the manage zones privilege.
      </Card>
    );
  }
  if (!map.viewer_file) {
    return (
      <Card className="text-sm">
        This map has no 3D map file yet. Upload it under 3D map file on the
        map&apos;s{" "}
        <Link href={`/maps/${map.name}/manage`} className="underline">
          Manage
        </Link>{" "}
        page, or publish its zones from a shavit zones file.
      </Card>
    );
  }
  return (
    <ZoneEditor
      map={map.name}
      zones={map.zone_sets[0]?.zones ?? []}
      edit={{ basedOn: map.zone_sets[0]?.version ?? null }}
      viewerFile={map.viewer_file}
      tracks={map.tracks.map((track) => track.track)}
    />
  );
}
