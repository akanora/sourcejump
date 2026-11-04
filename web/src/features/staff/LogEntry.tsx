// One staff log entry as one line: who did what to whom, how long ago, and why when a reason was given.
import type { Schemas } from "@/api/client";
import { formatReleaseDate } from "@/features/maps/releaseDate";
import { RunLink } from "@/features/runs/RunLink";
import {
  formatDateTime,
  formatSince,
  formatTime,
  trackName,
} from "@/features/runs/time";
import { Link } from "@/ui/Link";
import { Tooltip } from "@/ui/Tooltip";
import { restrictionList, restrictionsIn } from "./players/restrictions";
import { privilegeLabels, privilegesIn } from "./privileges";

type Entry = Schemas["StaffLogEntry"];

/**
 * "How long ago" counts from when the page was read. `run` is the run whose page shows the entry, which it
 * then calls "this run".
 */
export function LogEntry({ entry, run }: { entry: Entry; run?: number }) {
  return (
    <li className="flex items-baseline gap-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p>
          {entry.actor ? (
            <PlayerName player={entry.actor} />
          ) : (
            <span className="text-text-muted">Command line</span>
          )}{" "}
          {describe(entry, run)}
        </p>
        {entry.reason && (
          <p className="text-text-subtle text-sm">
            &ldquo;{entry.reason}&rdquo;
          </p>
        )}
      </div>
      <Tooltip content={formatDateTime(entry.at)}>
        {/* The log's pages are rendered on the server and again in the browser, which can be a minute later
            ("38 min ago" against "39 min ago"); either is right, so the server's stands. */}
        <time
          dateTime={entry.at}
          tabIndex={0}
          suppressHydrationWarning
          className="text-text-subtle rounded-sm text-sm whitespace-nowrap"
        >
          {formatSince(entry.at)}
        </time>
      </Tooltip>
    </li>
  );
}

function describe(entry: Entry, run?: number) {
  const action = entry.action;
  switch (action) {
    case "grant_privileges":
      return (
        <>
          granted {privilegeList(entry.detail.privileges)} to{" "}
          <Target entry={entry} />
        </>
      );
    case "revoke_privileges":
      return (
        <>
          revoked {privilegeList(entry.detail.privileges)} from{" "}
          <Target entry={entry} />
        </>
      );
    case "issue_key":
      return (
        <>
          issued key <KeyPrefix prefix={entry.target} /> for{" "}
          {textIn(entry.detail.server) ?? "a server"}
        </>
      );
    case "revoke_key":
      return (
        <>
          revoked key <KeyPrefix prefix={entry.target} /> of{" "}
          {textIn(entry.detail.server) ?? "a server"}
        </>
      );
    case "replace_key":
      return (
        <>
          replaced key{" "}
          <KeyPrefix prefix={textIn(entry.detail.replaced) ?? "?"} /> of{" "}
          {textIn(entry.detail.server) ?? "a server"} with{" "}
          <KeyPrefix prefix={entry.target} />
        </>
      );
    case "list_server":
      return (
        <>
          listed server <span className="tabular-nums">{entry.target}</span>
        </>
      );
    case "unlist_server":
      return (
        <>
          unlisted server <span className="tabular-nums">{entry.target}</span>
        </>
      );
    case "mark_server_whitelist":
      return (
        <>
          marked server <span className="tabular-nums">{entry.target}</span> as
          whitelist
        </>
      );
    case "mark_server_public":
      return (
        <>
          marked server <span className="tabular-nums">{entry.target}</span> as
          public
        </>
      );
    case "publish_ruleset":
      return <>published ruleset version {entry.target}</>;
    case "publish_policy":
      return (
        <>
          published the {entry.target} policy
          {typeof entry.detail.version === "number" &&
            `, version ${entry.detail.version}`}
        </>
      );
    case "set_tier":
      return (
        <>
          rated <MapLink map={entry.target} />{" "}
          {trackName(Number(entry.detail.track ?? 0)).toLowerCase()} tier{" "}
          {String(entry.detail.tier)}
        </>
      );
    case "set_map_image":
      return (
        <>
          {/* Entries from before uploads name a link, `image_url`, instead of a stored `image`. */}
          {entry.detail.image || entry.detail.image_url ? "set" : "cleared"} the
          image of <MapLink map={entry.target} />
        </>
      );
    case "add_map_image": {
      // A folder import gives a map several pictures in one entry, listed in `images`.
      const images: unknown = entry.detail.images;
      if (Array.isArray(images)) {
        const count = images.length;
        return (
          <>
            added {count} {count === 1 ? "picture" : "pictures"} to{" "}
            <MapLink map={entry.target} />
          </>
        );
      }
      return (
        <>
          added a picture to <MapLink map={entry.target} />
          {entry.detail.cover === true && ", as its cover"}
        </>
      );
    }
    case "remove_map_image":
      return (
        <>
          removed {entry.detail.cover === true ? "the cover" : "a picture"} of{" "}
          <MapLink map={entry.target} />
        </>
      );
    case "order_map_images":
      return (
        <>
          reordered the pictures of <MapLink map={entry.target} />
        </>
      );
    case "set_banner_focus":
      return (
        <>
          moved the banner of <MapLink map={entry.target} />
        </>
      );
    case "set_map_description":
      return (
        <>
          {entry.detail.description ? "set" : "cleared"} the description of{" "}
          <MapLink map={entry.target} />
        </>
      );
    case "set_map_release":
      return (
        <>
          set the release of <MapLink map={entry.target} />
          {isReleaseDate(entry.detail.released)
            ? `: ${formatReleaseDate(entry.detail.released)}`
            : ": date unknown"}
          {typeof entry.detail.mapper === "string" ? (
            <>
              , mapper{" "}
              <Link
                href={`/players/${entry.detail.mapper}`}
                className="hover:text-accent tabular-nums"
              >
                {entry.detail.mapper}
              </Link>
            </>
          ) : (
            ", mapper unknown"
          )}
        </>
      );
    case "publish_zones":
      return (
        <>
          published zones for <MapLink map={entry.target} />
          {typeof entry.detail.version === "number" &&
            `, version ${entry.detail.version}`}
        </>
      );
    case "upload_viewer_file":
      return (
        <>
          uploaded the 3D map file of <MapLink map={entry.target} />
        </>
      );
    case "invalidate_run":
      return (
        <>
          invalidated <LoggedRun entry={entry} page={run} />
        </>
      );
    case "restore_run":
      return (
        <>
          restored <LoggedRun entry={entry} page={run} />
        </>
      );
    case "invalidate_player_runs":
      return (
        <>
          invalidated {runCount(entry.detail.runs)} by <Target entry={entry} />
        </>
      );
    case "invalidate_key_runs":
      return (
        <>
          invalidated {runCount(entry.detail.runs)} sent with key{" "}
          <KeyPrefix prefix={entry.target} /> of{" "}
          {textIn(entry.detail.server) ?? "a server"}
        </>
      );
    case "invalidate_server_runs":
      return (
        <>
          invalidated {runCount(entry.detail.runs)} sent by{" "}
          {textIn(entry.detail.server) ?? "a server"}
        </>
      );
    case "restore_runs": {
      const server = textIn(entry.detail.server);
      return (
        <>
          restored {runCount(entry.detail.runs)}{" "}
          {entry.target_player ? (
            <>
              of <PlayerName player={entry.target_player} />
            </>
          ) : server ? (
            <>sent by {server}</>
          ) : (
            <>
              of key <KeyPrefix prefix={entry.target} />
            </>
          )}
        </>
      );
    }
    case "ban_player": {
      const endsAt = textIn(entry.detail.ends_at);
      return (
        <>
          banned <Target entry={entry} /> from{" "}
          {restrictionList(
            restrictionsIn(entry.detail.restrictions),
          ).toLowerCase()}
          {endsAt ? `, until ${formatDateTime(endsAt)}` : ", until lifted"}
          {entry.detail.legacy === true && ", carried over from the old site"}
        </>
      );
    }
    case "lift_ban":
      return (
        <>
          lifted <Target entry={entry} />
          &apos;s ban from{" "}
          {restrictionList(
            restrictionsIn(entry.detail.restrictions),
          ).toLowerCase()}
        </>
      );
    case "hide_post":
      return (
        <>
          removed the post <LoggedPost entry={entry} />
        </>
      );
    case "restore_post":
      return (
        <>
          restored the post{" "}
          <Link
            href={`/community/${entry.target}`}
            className="hover:text-accent"
          >
            <LoggedPost entry={entry} />
          </Link>
        </>
      );
    case "edit_post":
      return (
        <>
          edited the {fieldList(entry.detail.changed)} of the post{" "}
          <Link
            href={`/community/${entry.target}`}
            className="hover:text-accent"
          >
            <LoggedPost entry={entry} />
          </Link>
          {textIn(entry.detail.previous_title) !== textIn(entry.detail.title) &&
            `, formerly “${textIn(entry.detail.previous_title) ?? ""}”`}
        </>
      );
    case "hide_run_comment":
      return (
        <>
          removed <LoggedComment entry={entry} page={run} />
        </>
      );
    case "restore_run_comment":
      return (
        <>
          restored <LoggedComment entry={entry} page={run} />
        </>
      );
    case "edit_player_details":
      return (
        <>
          changed <Target entry={entry} />
          &apos;s {detailList(entry.detail.changed)}
        </>
      );
    default:
      return action satisfies never;
  }
}

const DETAIL_FIELDS: Partial<Record<string, string>> = {
  mouse: "mouse",
  dpi: "DPI",
  sensitivity: "sensitivity",
  mouse_pad: "mouse pad",
  keyboard: "keyboard",
  monitor: "monitor",
  aspect: "aspect ratio",
  country: "country",
};

/** "mouse and DPI", from a profile details edit's `changed` list. */
function detailList(value: unknown): string {
  const names = Array.isArray(value)
    ? value.flatMap((field) =>
        typeof field === "string" && DETAIL_FIELDS[field]
          ? [DETAIL_FIELDS[field]]
          : [],
      )
    : [];
  return names.length
    ? new Intl.ListFormat("en").format(names)
    : "profile details";
}

const POST_FIELDS: Record<string, string> = {
  kind: "kind",
  title: "title",
  body: "text",
  video: "video link",
};

/** "title and text", from an edit's `changed` list. */
function fieldList(value: unknown): string {
  const names = (Array.isArray(value) ? value : [])
    .filter((field): field is string => typeof field === "string")
    .map((field) => POST_FIELDS[field] ?? field);
  if (names.length === 0) return "content";
  return new Intl.ListFormat("en").format(names);
}

/** "“Spam” by kite", from what the entry recorded about the post then. */
function LoggedPost({ entry }: { entry: Entry }) {
  const title = textIn(entry.detail.title) ?? `#${entry.target}`;
  const author = textIn(entry.detail.author_name);
  return (
    <>
      &ldquo;{title}&rdquo;{author && ` by ${author}`}
    </>
  );
}

const COMMENT_EXCERPT_CHARS = 80;

/** Whose comment, its opening words, and the run it's on: "this run" on that run's own page. */
function LoggedComment({ entry, page }: { entry: Entry; page?: number }) {
  const author = textIn(entry.detail.author_name);
  const body = textIn(entry.detail.body) ?? "";
  const excerpt =
    body.length > COMMENT_EXCERPT_CHARS
      ? `${body.slice(0, COMMENT_EXCERPT_CHARS).trimEnd()}…`
      : body;
  const run = Number(textIn(entry.detail.run));
  return (
    <>
      {author ? `${author}'s comment` : "a comment"} &ldquo;{excerpt}&rdquo; on{" "}
      {run === page ? (
        "this run"
      ) : run ? (
        // The run dialog doesn't show comments, so this opens the run's page.
        <Link href={`/runs/${run}`} className="hover:text-accent">
          run #{run}
        </Link>
      ) : (
        "a run"
      )}
    </>
  );
}

function MapLink({ map }: { map: string }) {
  return (
    <Link href={`/maps/${map}/manage`} className="hover:text-accent">
      {map}
    </Link>
  );
}

/** "run #812 by nova, 1:02.341 on bhop_badges", from what the entry recorded about the run then. */
function LoggedRun({ entry, page }: { entry: Entry; page?: number }) {
  if (page !== undefined && Number(entry.target) === page) return <>this run</>;
  const { player_name, map, time } = entry.detail;
  return (
    <>
      <RunLink runId={Number(entry.target)} className="hover:text-accent">
        run #{entry.target}
      </RunLink>
      {typeof player_name === "string" && ` by ${player_name}`}
      {typeof time === "number" && `, ${formatTime(time)}`}
      {typeof map === "string" && ` on ${map}`}
    </>
  );
}

function runCount(value: unknown): string {
  const runs = typeof value === "number" ? value : 0;
  return `${runs.toLocaleString("en")} ${runs === 1 ? "run" : "runs"}`;
}

function textIn(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function KeyPrefix({ prefix }: { prefix: string }) {
  return <code className="text-text-muted tabular-nums">{prefix}…</code>;
}

function privilegeList(value: unknown): string {
  const names = privilegesIn(value).map((p) => privilegeLabels[p]);
  return names.length > 0
    ? new Intl.ListFormat("en").format(names)
    : "privileges";
}

/** The player the action was on, or the raw target when SourceJump doesn't know them. */
function Target({ entry }: { entry: Entry }) {
  return entry.target_player ? (
    <PlayerName player={entry.target_player} />
  ) : (
    <span className="tabular-nums">{entry.target}</span>
  );
}

function PlayerName({ player }: { player: Schemas["PlayerRef"] }) {
  return (
    <Link
      href={`/players/${player.steamid64}`}
      className="text-text-muted hover:text-accent transition-colors duration-(--duration-fast)"
    >
      {player.name}
    </Link>
  );
}

/** The log's detail is free-form JSON, so a release date is checked before it's shown. */
function isReleaseDate(value: unknown): value is Schemas["ReleaseDate"] {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { year?: unknown }).year === "number"
  );
}
