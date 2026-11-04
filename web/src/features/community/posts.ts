// Where a community post lives, and who may write or change posts. The API enforces the same rules; these
// only decide which buttons to show.
import type { Schemas } from "@/api/client";

export function postHref(post: { id: number; slug: string }): string {
  return `/community/${post.id}-${post.slug}`;
}

/** The Community page for a kind of post, and older posts before a cursor. */
export function communityHref(choice: {
  kind?: Schemas["PostKind"];
  before?: string | null;
}): string {
  const query = new URLSearchParams();
  if (choice.kind) query.set("kind", choice.kind);
  if (choice.before) query.set("before", choice.before);
  const text = query.toString();
  return text ? `/community?${text}` : "/community";
}

/** Players with `post_community` write posts; staff with `manage_posts` may too. */
export function canPost(me: Schemas["Me"] | null | undefined): boolean {
  return (
    !!me &&
    (me.privileges.includes("post_community") ||
      me.privileges.includes("manage_posts"))
  );
}

/** Authors change their own posts while they may post; `manage_posts` changes anyone's. */
export function canChange(
  me: Schemas["Me"] | null | undefined,
  post: Schemas["PostSummary"],
): boolean {
  if (!me) return false;
  if (me.privileges.includes("manage_posts")) return true;
  return (
    me.steamid64 === post.author.steamid64 &&
    me.privileges.includes("post_community")
  );
}
