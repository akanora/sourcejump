// The Community page's posts, newest first, with a choice of kind and a link to older posts. Nothing here
// depends on who is signed in; their buttons and staff tools load in the browser.
import { api, type Schemas } from "@/api/client";
import { LinkTabs } from "@/ui/LinkTabs";
import { NewPostButton } from "./NewPostButton";
import { PostCards } from "./PostCards";
import { communityHref } from "./posts";

const kinds = [
  { key: undefined, label: "All" },
  { key: "article", label: "Articles" },
  { key: "video", label: "Videos" },
] as const;
type Kind = Schemas["PostKind"];

export async function PostList({
  params,
}: {
  params: { kind?: string; before?: string };
}) {
  const kind = kinds.find((k) => k.key === params.kind)?.key as
    Kind | undefined;
  const result = await api
    .GET("/v1/posts", {
      params: { query: { kind, cursor: params.before } },
    })
    .catch(() => undefined);
  const list = result?.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkTabs
          label="Kind"
          tabs={kinds.map((k) => ({
            href: communityHref({ kind: k.key }),
            label: k.label,
            current: k.key === kind,
          }))}
        />
        <NewPostButton />
      </div>

      {list ? (
        <PostCards list={list} kind={kind} before={params.before} />
      ) : (
        <p>Posts couldn&apos;t be loaded. Try again in a moment.</p>
      )}
    </div>
  );
}
