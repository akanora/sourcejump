// The writing page's gate: the form for players who may post (or change this post), a reason otherwise.
import { notFound } from "next/navigation";
import { api } from "@/api/client";
import { signedInPlayer } from "@/features/auth/signedInPlayer";
import { Card } from "@/ui/Card";
import { PostForm } from "./PostForm";
import { canChange, canPost } from "./posts";

/** Without `path`, a new post; with it, editing that post. */
export async function WritePost({ path }: { path?: string }) {
  const [me, result] = await Promise.all([
    signedInPlayer(),
    path
      ? api
          .GET("/v1/posts/{post}", { params: { path: { post: path } } })
          .catch(() => undefined)
      : undefined,
  ]);
  if (path && result?.response.status === 404) notFound();
  const post = result?.data;
  if (path && !post) {
    return <p>This post couldn&apos;t be loaded. Try again in a moment.</p>;
  }
  if (!me) {
    return (
      <Card className="text-text-muted">
        Sign in with Steam to write posts.
      </Card>
    );
  }
  const allowed = post ? canChange(me, post) : canPost(me);
  if (!allowed) {
    return (
      <Card className="text-text-muted">
        {post
          ? "Only this post's author or staff can change it."
          : "Posting is open to players staff have allowed to post."}
      </Card>
    );
  }
  return (
    <PostForm
      post={post}
      asStaff={!!post && post.author.steamid64 !== me.steamid64}
    />
  );
}
