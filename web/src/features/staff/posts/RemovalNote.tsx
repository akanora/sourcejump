"use client";
// How a removed post was removed, for staff: who, when and why, and Restore where it's allowed. Staff restore
// only what staff removed, and never their own post (lead, 2026-10-20).
import type { Schemas } from "@/api/client";
import { formatDate } from "@/features/runs/time";
import { RestorePost } from "./RestorePost";

export function RemovalNote({
  post,
  removal,
  me,
  onRestored,
}: {
  post: Pick<Schemas["PostSummary"], "id" | "title" | "author">;
  removal: Schemas["Removal"];
  me: Schemas["Me"];
  onRestored?: () => void;
}) {
  const by = removal.by_author
    ? "its author"
    : (removal.hidden_by?.name ?? "staff");
  const blocked = removal.by_author
    ? "Its author removed it, so it stays removed"
    : me.steamid64 === post.author.steamid64
      ? "Your post: another staff member can restore it"
      : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
      <p className="text-text-muted">
        Removed by {by},{" "}
        <time dateTime={removal.hidden_at}>
          {formatDate(removal.hidden_at)}
        </time>
        {removal.reason && ` · ${removal.reason}`}
      </p>
      {blocked ? (
        <span className="text-text-subtle text-xs">{blocked}</span>
      ) : (
        <RestorePost id={post.id} title={post.title} onRestored={onRestored} />
      )}
    </div>
  );
}
