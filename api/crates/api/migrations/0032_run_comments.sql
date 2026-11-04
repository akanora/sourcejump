-- Comments on runs, by any signed-in player not banned from posting. Plain text; never edited. Replies go one
-- level deep: `reply_to` names a top-level comment. The run's player may pin one top-level comment.
-- Removing keeps the row: by its author (`hidden_by` is the author) or by staff (`hidden_log_id` names the
-- staff log entry).
CREATE TABLE run_comments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES runs (id),
    reply_to bigint REFERENCES run_comments (id),
    author_steamid64 bigint NOT NULL REFERENCES players (steamid64),
    body text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    pinned_at timestamptz,
    hidden_at timestamptz,
    hidden_by bigint REFERENCES players (steamid64),
    hidden_log_id bigint UNIQUE REFERENCES staff_log (id),
    CHECK (hidden_log_id IS NULL OR hidden_at IS NOT NULL),
    CHECK (pinned_at IS NULL OR reply_to IS NULL)
);
-- A run's comments, newest first, a page at a time, and how many it shows.
CREATE INDEX run_comments_by_run ON run_comments (run_id, id DESC);
-- A comment's replies, oldest first.
CREATE INDEX run_comments_replies ON run_comments (reply_to, id) WHERE reply_to IS NOT NULL;
-- At most one pinned comment per run.
CREATE UNIQUE INDEX run_comments_pinned ON run_comments (run_id) WHERE pinned_at IS NOT NULL;
-- A player's latest comment, for the wait between comments.
CREATE INDEX run_comments_by_author ON run_comments (author_steamid64, created_at DESC);
