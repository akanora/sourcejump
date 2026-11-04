// A map's own view, under its header: the description, then its boards per style and track. The map's one API
// request carries every style and track, so switching between them never loads a page.
import { notFound } from "next/navigation";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { currentStyles } from "@/features/ruleset/styles";
import { MapBoards } from "./MapBoards";
import { getMap } from "./mapDetail";

export async function MapView({ name }: { name: string }) {
  const [result, styles, me] = await Promise.all([
    getMap(name),
    currentStyles(),
    signedInPlayer(),
  ]);
  if (result?.response.status === 404 || result?.response.status === 422) {
    notFound();
  }
  const map = result?.data;
  if (!map) {
    return <p>This map couldn&apos;t be loaded. Try again in a moment.</p>;
  }

  return (
    <>
      {map.description && (
        <p className="text-text-muted max-w-prose whitespace-pre-line">
          {map.description}
        </p>
      )}
      <MapBoards
        map={map}
        styleOrder={styles.keys}
        styleNames={Object.fromEntries(
          styles.keys.map((k) => [k, styles.name(k)]),
        )}
        me={me?.steamid64}
      />
    </>
  );
}
