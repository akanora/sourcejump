// A post that isn't published: not found for everyone, but staff who hold manage_posts read a removed post
// here, and restore it where allowed. The page is marked noindex like any not-found page, whoever reads it.
import { NotFoundMessage } from "@/features/site/NotFoundMessage";
import { RemovedPost } from "@/features/staff/posts/RemovedPost";
import { Page } from "@/ui/Page";

export default function PostNotFound() {
  return (
    <Page width="narrow">
      <RemovedPost fallback={<NotFoundMessage />} />
    </Page>
  );
}
