-- The Discord record feeds (`record_events/discord.rs`): how far each has read the record events, and which
-- runs each has posted, so a restart neither skips nor repeats a post. `feed` is the feed's name from the
-- API's config.

CREATE TABLE discord_feed_cursors (
    feed text PRIMARY KEY,
    -- The record-events cursor the feed has handled everything before.
    tx bigint NOT NULL,
    id bigint NOT NULL
);

-- A restored record is reported again as a new event; this keeps it from being posted twice.
CREATE TABLE discord_feed_posts (
    run_id bigint NOT NULL REFERENCES runs (id),
    feed text NOT NULL,
    posted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, feed)
);
