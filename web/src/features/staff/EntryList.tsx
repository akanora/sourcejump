"use client";
// The staff log's entries about one run, player or map: the first 50 as the page read them, then Load more
// for the next 50 at a time, read in the browser. Callers key it by the newest entry, so a change that adds
// one starts the list over.
import { useState } from "react";
import { api, type Schemas } from "@/api/client";
import { Button } from "@/ui/Button";
import { DividedList } from "@/ui/Divided";
import { LogEntry } from "./LogEntry";

type Page = Schemas["LogEntries"];
export type EntriesAbout =
  { run: number } | { player: string } | { map: string };

function readOlder(about: EntriesAbout, before: string) {
  const query = { before };
  if ("run" in about) {
    return api.GET("/v1/staff/runs/{id}/log", {
      params: { path: { id: about.run }, query },
    });
  }
  if ("player" in about) {
    return api.GET("/v1/staff/players/{player}/log", {
      params: { path: { player: about.player }, query },
    });
  }
  return api.GET("/v1/staff/maps/{map}/log", {
    params: { path: { map: about.map }, query },
  });
}

export function EntryList({
  about,
  first,
  empty,
}: {
  about: EntriesAbout;
  first: Page;
  /** What to say when there are no entries. */
  empty: string;
}) {
  const [pages, setPages] = useState<Page[]>([first]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const entries = pages.flatMap((page) => page.entries);
  const older = pages[pages.length - 1]?.older;

  async function loadMore() {
    if (!older) return;
    setLoading(true);
    setFailed(false);
    const result = await readOlder(about, older).catch(() => undefined);
    setLoading(false);
    const page = result?.data;
    if (page) setPages((current) => [...current, page]);
    else setFailed(true);
  }

  if (entries.length === 0) {
    return <p className="text-text-muted text-sm">{empty}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <DividedList as="ul">
        {entries.map((entry) => (
          <LogEntry
            key={entry.id}
            entry={entry}
            run={"run" in about ? about.run : undefined}
          />
        ))}
      </DividedList>
      {failed && (
        <p className="text-danger text-sm">
          Older entries couldn&apos;t be loaded. Try again.
        </p>
      )}
      {older && (
        <Button
          size="sm"
          variant="ghost"
          className="self-center"
          onClick={loadMore}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
