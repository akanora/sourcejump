// One community post: its title, author, text and, for a video, the link to watch it. Its author and staff
// get Edit and Remove from the browser. A removed post is not found here; staff see it on the not-found page.
import { notFound, redirect } from "next/navigation";
import { api } from "@/api/client";
import { PostActions } from "./PostActions";
import { BackToCommunity, PostContent } from "./PostContent";
import { postHref } from "./posts";

export async function PostView({ path }: { path: string }) {
  const result = await api
    .GET("/v1/posts/{post}", { params: { path: { post: path } } })
    .catch(() => undefined);
  if (result?.response.status === 404) notFound();
  const post = result?.data;
  if (!post) {
    return <p>This post couldn&apos;t be loaded. Try again in a moment.</p>;
  }
  // An old title in the address, or none, lands on the current one.
  if (path !== `${post.id}-${post.slug}`) redirect(postHref(post));

  return (
    <article className="flex flex-col gap-6">
      <BackToCommunity />
      <PostContent post={post} />
      <PostActions post={post} />
    </article>
  );
}
