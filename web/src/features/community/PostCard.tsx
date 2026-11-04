// One post on the Community page: its kind, title, opening words, author and, for a video, the link to
// watch it. Staff also see removed posts, dimmed with a dashed edge, with how they were removed below.
import { Play } from "lucide-react";
import type { ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { Badge } from "@/ui/Badge";
import { Card } from "@/ui/Card";
import { classNames } from "@/ui/classNames";
import { DividedSection } from "@/ui/Divided";
import { Link } from "@/ui/Link";
import { PostByline } from "./PostByline";
import { WatchOnYouTube } from "./WatchOnYouTube";
import { postHref } from "./posts";

export function PostCard({
  post,
  removal,
}: {
  post: Schemas["PostSummary"];
  /** For staff: how a removed post was removed, kept at full strength under the dimmed post. */
  removal?: ReactNode;
}) {
  const removed = removal != null;
  return (
    <Card
      className={classNames("flex flex-col gap-2", removed && "border-dashed")}
    >
      <div
        className={classNames(
          "flex flex-col gap-2 transition-opacity duration-(--duration-base)",
          removed && "opacity-50",
        )}
      >
        <div className="flex items-center gap-2">
          {post.kind === "video" ? (
            <Badge tone="accent">
              <Play aria-hidden />
              Video
            </Badge>
          ) : (
            <Badge>Article</Badge>
          )}
          {removed && <Badge tone="danger">Removed</Badge>}
        </div>
        <h2 className="text-lg font-bold">
          <Link href={postHref(post)} className="hover:text-accent">
            {post.title}
          </Link>
        </h2>
        {post.excerpt && <p className="text-text-muted">{post.excerpt}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PostByline post={post} />
          {post.video_url && !removed && (
            <WatchOnYouTube href={post.video_url} size="sm" />
          )}
        </div>
      </div>
      {removed && <DividedSection className="mt-1">{removal}</DividedSection>}
    </Card>
  );
}
