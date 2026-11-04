// Every internal link on the site. Navigates without a full page load, and never preloads the target.
import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * Next.js preloads a link's page when the link scrolls into view or is hovered. The lead chose to
 * load a page only when it's actually opened, so prefetching is off here; the page fade covers the
 * wait. Lint stops other files importing next/link, so this default can't be bypassed by accident.
 */
export function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
