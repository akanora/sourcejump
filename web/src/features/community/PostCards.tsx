"use client";
// The Community page's posts and the link to older ones. Everyone gets the published posts rendered on the
// server; staff who hold manage_posts then get the same page from the browser with removed posts in place.
import type { CSSProperties, ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { RemovalNote } from "@/features/staff/posts/RemovalNote";
import { useStaffPosts } from "@/features/staff/posts/useStaffPosts";
import { ButtonLink } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { PostCard } from "./PostCard";
import { communityHref } from "./posts";

export function PostCards({
  list,
  kind,
  before,
}: {
  list: Schemas["PostList"];
  kind?: Schemas["PostKind"];
  before?: string;
}) {
  const staff = useStaffPosts({ kind, before });
  const shown = staff
    ? {
        next_cursor: staff.list.next_cursor,
        posts: staff.list.posts.map((post) => ({
          id: post.id,
          card: (
            <PostCard
              post={post}
              removal={
                post.removal && (
                  <RemovalNote
                    post={post}
                    removal={post.removal}
                    me={staff.me}
                    onRestored={staff.reload}
                  />
                )
              }
            />
          ),
        })),
      }
    : {
        next_cursor: list.next_cursor,
        posts: list.posts.map((post) => ({
          id: post.id,
          card: <PostCard post={post} />,
        })),
      };

  if (shown.posts.length === 0) {
    return (
      <Card className="text-text-muted">
        {before ? "No older posts." : "Nothing has been posted yet."}
      </Card>
    );
  }
  return (
    <>
      <Cards posts={shown.posts} />
      {shown.next_cursor && (
        <div className="flex justify-center">
          <ButtonLink
            href={communityHref({ kind, before: shown.next_cursor })}
            size="sm"
          >
            Older posts
          </ButtonLink>
        </div>
      )}
    </>
  );
}

/** Keyed by post, so a card the public list already showed stays put when the staff list replaces it. */
function Cards({ posts }: { posts: { id: number; card: ReactNode }[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {posts.map(({ id, card }, index) => (
        <li
          key={id}
          className="motion-enter"
          style={
            {
              "--motion-delay": `${Math.min(index, 12) * 25}ms`,
            } as CSSProperties
          }
        >
          {card}
        </li>
      ))}
    </ul>
  );
}
