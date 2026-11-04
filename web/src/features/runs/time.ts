// How run times and dates are written everywhere on the site.

/** A run time in seconds as `24.405`, `1:24.405` or `1:02:03.004`, always to the millisecond. */
export function formatTime(seconds: number): string {
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const fraction = `.${String(ms).padStart(3, "0")}`;
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}${fraction}`;
  }
  if (m > 0) {
    return `${m}:${pad(s)}${fraction}`;
  }
  return `${s}${fraction}`;
}

/** A gap to the record, as `+0.605` or `+1:02.330`; zero is `+0.000`. */
export function formatGap(seconds: number): string {
  return `+${formatTime(Math.max(seconds, 0))}`;
}

/** "Main" for track 0, "Bonus 1" and up for the rest. */
export function trackName(track: number): string {
  return track === 0 ? "Main" : `Bonus ${track}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// UTC, so the server and every visitor see the same date for a run.
const dateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** A date like `Oct 19, 2026`. */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

const dateTimeFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** A moment like `Oct 19, 2026, 14:03 UTC`, for logs where the time of day matters. */
export function formatDateTime(iso: string): string {
  return `${dateTimeFormat.format(new Date(iso))} UTC`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "12 minutes ago", "3 hours ago", "4 days ago", from whole minutes the API counted. */
export function formatAgo(minutes: number): string {
  if (minutes < 60) return relative.format(-minutes, "minute");
  if (minutes < 48 * 60)
    return relative.format(-Math.round(minutes / 60), "hour");
  return relative.format(-Math.round(minutes / (24 * 60)), "day");
}

const dayFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * How long ago a moment was, short enough for the edge of a list row: "just now", "12 min ago", "5 h ago",
 * "Yesterday", "3 days ago", then the date ("Oct 19", with the year once it isn't this one).
 */
export function formatSince(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return "Yesterday";
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  return then.getUTCFullYear() === now.getUTCFullYear()
    ? dayFormat.format(then)
    : formatDate(iso);
}

/** How long ago a moment was, in one short unit: "just now", "12m ago", "5h ago", "3d ago", "4mo ago", "2y ago". */
export function formatAge(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor(
    (now.getTime() - new Date(iso).getTime()) / 60_000,
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
