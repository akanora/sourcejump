"use client";
// The comments card on a run's page, under the replay: a box to comment in for signed-in players, the comment
// the run's player pinned, then the others newest first, 25 at a time with Show more, each with its replies.
// It loads in the browser, so the page stays the same for everyone; staff with manage_posts read the staff
// list instead, which keeps removed comments in place.
import { useCallback, useEffect, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { useSignedInPlayer } from "@/features/auth/useSignedInPlayer";
import { SignInButton } from "@/features/site/SignInButton";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { DividedList } from "@/ui/Divided";
import { CommentForm } from "./CommentForm";
import { CommentThread, type Viewer } from "./CommentThread";

type Page = Schemas["RunCommentList"];

function readPage(run: number, asStaff: boolean, cursor?: string) {
  const params = { path: { id: run }, query: { cursor } };
  return asStaff
    ? api.GET("/v1/staff/runs/{id}/comments", { params })
    : api.GET("/v1/runs/{id}/comments", { params });
}

export function RunComments({
  run,
  runner,
}: {
  run: number;
  /** The run's player, who may pin a comment. */
  runner: Schemas["PlayerRef"];
}) {
  const me = useSignedInPlayer();
  const asStaff = me?.privileges.includes("manage_posts") ?? false;
  // Undefined while loading, null when the first page couldn't be read.
  const [pages, setPages] = useState<Page[] | null>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // Counts reloads; threads are keyed by it, so each starts its loaded replies over.
  const [generation, setGeneration] = useState(0);
  // Replies posted since the first page was read: they're added in place, so the count goes up without a reload.
  const [repliesAdded, setRepliesAdded] = useState(0);

  /** Reads the first page again after a change: what's pinned and newest, and the count, may have moved. */
  const reload = useCallback(() => {
    void readPage(run, asStaff)
      .then((result) => {
        setPages(result.data ? [result.data] : null);
        setGeneration((count) => count + 1);
        setRepliesAdded(0);
      })
      .catch(() => setPages(null));
  }, [run, asStaff]);

  useEffect(() => {
    // Wait for who's signed in, so staff don't read the public list first.
    if (me !== undefined) reload();
  }, [me, reload]);

  async function showMore() {
    const cursor = pages?.at(-1)?.next_cursor;
    if (!cursor) return;
    setLoadingMore(true);
    setMoreFailed(false);
    const result = await readPage(run, asStaff, cursor).catch(() => undefined);
    setLoadingMore(false);
    const page = result?.data;
    if (page) setPages((current) => [...(current ?? []), page]);
    else setMoreFailed(true);
  }

  const first = pages?.[0];
  const total = (first?.total ?? 0) + repliesAdded;
  const pinned = first?.pinned ?? null;
  const threads = pages?.flatMap((page) => page.threads) ?? [];
  const more = pages?.at(-1)?.next_cursor;
  const viewer: Viewer = {
    me: me ?? null,
    asStaff,
    isRunner: me?.steamid64 === runner.steamid64,
  };

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="flex items-baseline gap-2 font-bold">
        Comments
        {total > 0 && (
          <span className="text-text-subtle text-sm font-normal tabular-nums">
            {total}
          </span>
        )}
      </h2>
      {me === undefined ? null : me ? (
        <CommentForm run={run} me={me} onPosted={reload} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <SignInButton />
          <p className="text-text-muted text-sm">to comment on this run.</p>
        </div>
      )}
      {pages === null ? (
        <p className="text-text-muted text-sm">
          The comments couldn&apos;t be loaded. Try again in a moment.
        </p>
      ) : pages === undefined ? null : !pinned && threads.length === 0 ? (
        <p className="text-text-muted text-sm">No comments yet.</p>
      ) : (
        <>
          <DividedList as="ul" className="border-border border-t">
            {[...(pinned ? [pinned] : []), ...threads].map((thread) => (
              <CommentThread
                key={`${generation}-${thread.id}`}
                run={run}
                runner={runner}
                thread={thread}
                pinned={thread === pinned}
                viewer={viewer}
                onChanged={reload}
                onReplied={() => setRepliesAdded((count) => count + 1)}
              />
            ))}
          </DividedList>
          {moreFailed && (
            <p className="text-danger text-sm">
              More comments couldn&apos;t be loaded. Try again.
            </p>
          )}
          {more && (
            <Button
              size="sm"
              variant="ghost"
              className="self-center"
              onClick={showMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Show more"}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
