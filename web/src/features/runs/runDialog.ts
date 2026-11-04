// Opening and closing the run dialog: a `?run=` parameter on the current page's address, changed without a
// page load, so the dialog opens at once, can be shared, and Back closes it.

/** Whether this tab's history has the entry `openRun` added, so closing can step back over it. */
let openedHere = false;

export const RUN_PARAM = "run";
/** A pre-2.0 run: its own parameter, since the old site's run IDs can equal 2.0's. */
export const PRE_RUN_PARAM = "pre_run";

export function openRun(runId: number, { legacy = false } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set(legacy ? PRE_RUN_PARAM : RUN_PARAM, String(runId));
  url.searchParams.delete(legacy ? RUN_PARAM : PRE_RUN_PARAM);
  // Next.js syncs pushState into useSearchParams without navigating (docs: linking and navigating).
  window.history.pushState(null, "", url);
  openedHere = true;
}

export function closeRun() {
  if (openedHere) {
    openedHere = false;
    window.history.back();
    return;
  }
  // Opened from a shared link: there's no entry to step back to, so drop the parameter instead.
  const url = new URL(window.location.href);
  url.searchParams.delete(RUN_PARAM);
  url.searchParams.delete(PRE_RUN_PARAM);
  window.history.replaceState(null, "", url);
}
