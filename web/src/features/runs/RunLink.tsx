"use client";
// A link to a run that opens the run dialog in place. Its address is the run's own page, for new tabs. A
// pre-2.0 run has no page, so it's a button that only opens the dialog.
import type { MouseEvent, ReactNode } from "react";
import { openRun } from "./runDialog";

export function RunLink({
  runId,
  legacy = false,
  className,
  children,
}: {
  runId: number;
  /** A pre-2.0 run, whose ID is the old site's. */
  legacy?: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (legacy) {
    return (
      <button
        type="button"
        onClick={() => openRun(runId, { legacy: true })}
        className={className}
      >
        {children}
      </button>
    );
  }
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Modified clicks keep the browser's meaning: a new tab or window with the run's page.
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    openRun(runId);
  }
  return (
    <a href={`/runs/${runId}`} onClick={onClick} className={className}>
      {children}
    </a>
  );
}
