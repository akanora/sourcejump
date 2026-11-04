// Previous and next links under a paged list, with where the reader is.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ButtonLink } from "./Button";

/** Renders nothing when everything fits on one page. Pages count from 1. */
export function Pager({
  page,
  pageCount,
  href,
}: {
  page: number;
  pageCount: number;
  href: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-4">
      {page > 1 ? (
        <ButtonLink href={href(page - 1)} size="sm" scroll={false}>
          <ChevronLeft aria-hidden />
          Previous
        </ButtonLink>
      ) : (
        <span />
      )}
      <span className="text-text-muted text-sm tabular-nums">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <ButtonLink href={href(page + 1)} size="sm" scroll={false}>
          Next
          <ChevronRight aria-hidden />
        </ButtonLink>
      ) : (
        <span />
      )}
    </nav>
  );
}
