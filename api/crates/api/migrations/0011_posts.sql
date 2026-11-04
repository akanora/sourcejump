-- Community posts by players with the `post_community` privilege: articles (Markdown) and videos (a YouTube
-- video ID, with an optional note). Posts are content, not policy, so edits overwrite. Hiding keeps the row.
CREATE TABLE posts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('article', 'video')),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    -- Markdown. An article needs one; for a video it's an optional note.
    body text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
    video_id text CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
    author_steamid64 bigint NOT NULL REFERENCES players (steamid64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    hidden_at timestamptz,
    hidden_by bigint REFERENCES players (steamid64),
    CHECK ((kind = 'video') = (video_id IS NOT NULL)),
    CHECK (kind <> 'article' OR body <> '')
);
CREATE INDEX posts_shown ON posts (id DESC) WHERE hidden_at IS NULL;
