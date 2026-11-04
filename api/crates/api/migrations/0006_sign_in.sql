-- Steam sign-in: sessions, the OpenID nonces already used, each player's privileges and restrictions, and the
-- profile data copied from Steam.

ALTER TABLE players
    -- Bitmaps. Bit positions are defined in privileges.rs and never renumbered or reused.
    ADD COLUMN privileges bigint NOT NULL DEFAULT 0,
    -- What a player may not do. Its bits arrive with bans and moderation.
    ADD COLUMN restrictions bigint NOT NULL DEFAULT 0,
    -- From the player's public Steam profile; NULL until fetched, or when Steam has none.
    ADD COLUMN avatar_url text CHECK (avatar_url LIKE 'https://%'),
    ADD COLUMN country_code text CHECK (country_code ~ '^[A-Z]{2}$'),
    ADD COLUMN steam_profile_fetched_at timestamptz,
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE sessions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- SHA-256 of the token in the player's cookie. The token itself is stored nowhere.
    hash bytea NOT NULL UNIQUE CHECK (length(hash) = 32),
    player_steamid64 bigint NOT NULL REFERENCES players (steamid64),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Pushed forward on use, so an active player stays signed in.
    expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_player ON sessions (player_steamid64);

-- Steam's response nonces from recent sign-ins. An assertion whose nonce is here was already used once, so
-- replaying it is refused. Rows older than the accepted nonce age are deleted as new ones arrive.
CREATE TABLE openid_nonces (
    nonce text PRIMARY KEY,
    seen_at timestamptz NOT NULL DEFAULT now()
);

-- The Players page lists recently active players.
CREATE INDEX runs_finished_at ON runs (finished_at DESC);
