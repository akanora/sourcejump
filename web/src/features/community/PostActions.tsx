"use client";
// Edit and Remove under a post, for its author and staff. They appear once the browser knows who is signed
// in, so the post's page is the same for everyone.
import { Pencil } from "lucide-react";
import type { Schemas } from "@/api/client";
import { useSignedInPlayer } from "@/features/auth/useSignedInPlayer";
import { ButtonLink } from "@/ui/Button";
import { RemovePost } from "./RemovePost";
import { canChange, postHref } from "./posts";

export function PostActions({
  post,
  onRemoved,
}: {
  post: Schemas["PostSummary"];
  /** After staff remove it, for a caller that holds the post itself rather than reading it from the page. */
  onRemoved?: () => void;
}) {
  const me = useSignedInPlayer();
  if (!me || !canChange(me, post)) return null;
  return (
    <footer className="border-border motion-enter flex gap-2 border-t pt-4">
      <ButtonLink href={`${postHref(post)}/edit`} size="sm">
        <Pencil aria-hidden />
        Edit
      </ButtonLink>
      <RemovePost
        id={post.id}
        title={post.title}
        asStaff={me.steamid64 !== post.author.steamid64}
        onRemoved={onRemoved}
      />
    </footer>
  );
}
